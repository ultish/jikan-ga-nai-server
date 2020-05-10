import Sequelize from "sequelize";
import { combineResolvers } from "graphql-resolvers";
import {
  isAuthenticated,
  isMessageOwner,
  isTrackedDayOwner,
  isTrackedTaskOwner,
} from "./authorization";
import { ForbiddenError } from "apollo-server";

import pubsub, { EVENTS } from "../subscriptions";
import chargecode from "../models/chargecode";

import { toCursorHash, fromCursorHash } from "./message";

import moment from "moment";

import AsyncLock from "async-lock";

// how many minutes each time block represents
const TIMEBLOCK_DURATION = 15;

const timeChargeLock = new AsyncLock();

const calculateEndCursor = (edges) => {
  if (edges && edges.length) {
    return toCursorHash(edges[edges.length - 1].createdAt.getTime().toString());
  } else {
    return "";
  }
};

const getTrackedDay = async (trackedDayId, models, me) => {
  const trackedDays = await models.TrackedDay.findAll({
    limit: 1,
    where: {
      id: trackedDayId,
      userId: me.id,
    },
  });
  if (trackedDays.length) {
    return trackedDays[0];
  } else {
    return null;
  }
};

// TODO convert trackedTask to trackedTaskId or pass trackedDay in
const updateTimesheetCodeChanges = async (
  models,
  trackedDay,
  previousChargeCodes
  // newChargeCodes
) => {
  /*
  when code changes for a task, we need to wipe all TimeCharged for
  this task and re-create them

  - delete all timeCharges for a given trackedTaskId
  - count number of time blocks for a given trackedTaskId
  - multiple count and divide by chargecodes and that gives the new value

  call fetchTimeCharges() to re-create the timeCharge instances
  */

  // const timesheet = await models.Timesheet.findByPk(trackedTask.timesheetId);
  // const trackedDay = await models.TrackedDay.findByPk(trackedTask.trackeddayId);

  const previousChargeCodeIds = previousChargeCodes.map((cc) => cc.id);
  // const newChargeCodeIds = newChargeCodes.map((cc) => cc.id);

  // fetch all trackedTasks for this day
  const allTrackedTasks = await models.TrackedTask.findAll({
    where: {
      trackeddayId: trackedDay.id,
    },
  });

  // find all chargecode IDs used by the trackedTasks for this day
  const trackedTaskChargeCodeIds = await models.ChargeCode.findAll({
    attributes: ["id"],
    include: [
      {
        model: models.TrackedTask,
        through: "taskcodes",
        where: {
          id: {
            [Sequelize.Op.in]: allTrackedTasks.map((tt) => tt.id),
          },
        },
      },
    ],
  }).map((model) => model.id);

  const allChargeCodeIds = [...previousChargeCodeIds];
  trackedTaskChargeCodeIds.forEach((ccId) => {
    if (!allChargeCodeIds.includes(ccId)) {
      allChargeCodeIds.push(ccId);
    }
  });

  // fetch TimeCharges for this timesheet, trackedDay, and chargeCodes used
  const existingTimeCharges = await models.TimeCharge.findAll({
    where: {
      timesheetId: trackedDay.timesheetId,
      trackeddayId: trackedDay.id,
      chargecodeId: {
        [Sequelize.Op.in]: allChargeCodeIds,
      },
    },
  });

  // delete all timeCharges associated with this day
  for (let existingTC of existingTimeCharges) {
    await existingTC.destroy();
  }

  const allChargeCodesInDay = [];

  // regenerate the TimeCharges for all chargecodes used by the tasks
  const timeCharges = await fetchTimeCharges(
    models,
    trackedDay,
    trackedDay.timesheetId,
    trackedTaskChargeCodeIds
  );

  const chargeCodeToTimeChargeMap = {};
  timeCharges.forEach((tc) => {
    chargeCodeToTimeChargeMap[tc.chargecodeId] = tc;
  });

  // re-compute the time charged to each chargecode
  for (let trackedTask of allTrackedTasks) {
    const chargeCodes = await trackedTaskChargeCodes(models, trackedTask.id);
    const timeBlocks = await models.TimeBlock.findAll({
      where: {
        trackedtaskId: trackedTask.id,
      },
    });

    const numChargeCodes = chargeCodes.length;
    const value = (TIMEBLOCK_DURATION * timeBlocks.length) / numChargeCodes;

    for (let chargeCode of chargeCodes) {
      const timeCharge = chargeCodeToTimeChargeMap[chargeCode.id];
      timeCharge.value = timeCharge.value + value;
      await timeCharge.save();
    }
  }

  const timesheet = await models.Timesheet.findByPk(trackedDay.timesheetId);

  pubsub.publish(EVENTS.TRACKER.UPDATED_TIMESHEET, {
    timesheetUpdated: timesheet,
  });
};

/**
 * a lock is used here as both createTimeBlock and deleteTimeBlock will
 * read from TimeCharged.value and increment/decrement the value. These
 * 2 calls can be called nearly at the same time (drag mouse over blocks)
 * and it will call updateTimesheet together. Now node is single-threaded,
 * but this function is async so there is plenty of chances for node to
 * switch context and continue work elsewhere while it awaits a promise.
 */
const updateTimesheet = async (
  models,
  trackedDay,
  trackedTask,
  increment = true
) => {
  // find the timesheet first
  if (!trackedDay.timesheetId) {
    console.error("No timesheet for TrackedDay: " + trackedDay.id);
    return;
  }

  const timesheet = await models.Timesheet.findByPk(trackedDay.timesheetId);

  if (timesheet) {
    // get the 'timecharged' lock
    timeChargeLock.acquire("timecharged", async () => {
      const chargeCodes = await trackedTaskChargeCodes(models, trackedTask.id, [
        "id",
      ]);

      if (chargeCodes.length) {
        // not creating any ChargedTime without charge codes
        const timeCharges = await fetchTimeCharges(
          models,
          trackedDay,
          timesheet.id,
          chargeCodes.map((cc) => cc.id)
        );

        // for each timeCharges, add a bit of time
        let toIncrement = TIMEBLOCK_DURATION / timeCharges.length;
        if (!increment) {
          toIncrement = toIncrement * -1;
        }
        for (let timeCharge of timeCharges) {
          console.log(
            "TIMECHARGE: ",
            timeCharge.chargecodeId,
            timeCharge.value + toIncrement
          );
          timeCharge.value = Math.max(0, timeCharge.value + toIncrement);
          await timeCharge.save();
        }
      }

      pubsub.publish(EVENTS.TRACKER.UPDATED_TIMESHEET, {
        timesheetUpdated: timesheet,
      });
    });
  } else {
    console.error("Could not find Timesheet: " + trackedDay.timesheetId);
  }
};

/**
 * Fetches TimeCharges based on timesheet, chargecodes, and tracked day.
 *
 * Will create TimeCharges is they don't exist for these 3 combos
 *
 * @param {*} models
 * @param {*} trackedDay
 * @param {*} timesheetId
 * @param {*} chargeCodeIds
 */
const fetchTimeCharges = async (
  models,
  trackedDay,
  timesheetId,
  chargeCodeIds
) => {
  const existingTimeCharges = await models.TimeCharge.findAll({
    where: {
      timesheetId: timesheetId,
      trackeddayId: trackedDay.id,
      chargecodeId: {
        [Sequelize.Op.in]: chargeCodeIds,
      },
    },
  });

  const result = [...existingTimeCharges];
  if (chargeCodeIds.length !== existingTimeCharges.length) {
    const existingChargeCodeIds = existingTimeCharges.map(
      (tc) => tc.chargecodeId
    );

    // something missing, create them
    const missingChargeCodes = chargeCodeIds.filter(
      (id) => !existingChargeCodeIds.includes(id)
    );
    for (let chargeCodeId of missingChargeCodes) {
      // create TimeCharge
      const addedTimeCharge = await models.TimeCharge.create({
        date: trackedDay.date,
        value: 0,
        trackeddayId: trackedDay.id,
        timesheetId: timesheetId,
        chargecodeId: chargeCodeId,
      });

      result.push(addedTimeCharge);
    }
  }

  return result;
};

const trackedTaskChargeCodes = async (
  models,
  trackedTaskId,
  attributes = null
) => {
  return await models.ChargeCode.findAll({
    attributes,
    include: [
      {
        model: models.TrackedTask,
        through: "taskcodes",
        where: {
          id: trackedTaskId,
        },
      },
    ],
  });
};

export default {
  Query: {
    timesheet: async (parent, { trackedDayId }, { models, me }) => {
      // fetch the tracked day first

      let trackedDay = await getTrackedDay(trackedDayId, models, me);
      if (trackedDay) {
        // given this day, work out the week-ending
        const date = moment(trackedDay.date);

        let endOfWeek;
        // TODO special case end of year and start of year scenarios
        if (date.weekYear() !== date.year()) {
          // endOfWeek becomes the last day of the year instead
          endOfWeek = moment.endOf("year").startOf("day");
        } else {
          endOfWeek = date.clone().endOf("isoweek").startOf("day");
        }

        // find timesheet for this endOfWeek
        let timesheet = await models.Timesheet.findAll({
          where: {
            weekEndingDate: endOfWeek.toDate(),
          },
          limit: 1,
        });

        if (!timesheet.length) {
          // create it
          timesheet = await models.Timesheet.create({
            weekEndingDate: endOfWeek.toDate(),
            userId: me.id,
          });
          // trackedDay.timesheetId = timesheet.id;
          // trackedDay = await trackedDay.save();
        } else {
          timesheet = timesheet[0];
        }
        trackedDay.timesheetId = timesheet.id;
        await trackedDay.save();
        return timesheet;
      }
      return null;
    },
    trackedDay: async (parent, { trackedDayId }, { models, me }) => {
      return await models.TrackedDay.findByPk(trackedDayId);
    },

    trackedDays: async (parent, { cursor, limit = 100 }, { models, me }) => {
      const cursorOptions = cursor
        ? {
            where: {
              createdAt: {
                [Sequelize.Op.lt]: new Date(
                  Number.parseInt(fromCursorHash(cursor))
                ),
              },
              userId: me.id,
            },
          }
        : {
            where: {
              userId: me.id,
            },
          };

      const trackedDays = await models.TrackedDay.findAll({
        order: [["date", "DESC"]],
        limit: limit + 1,
        ...cursorOptions,
      });

      const hasNextPage = trackedDays.length > limit;
      const edges = hasNextPage ? trackedDays.slice(0, -1) : trackedDays;

      return {
        edges: edges,
        pageInfo: {
          hasNextPage,
          endCursor: calculateEndCursor(edges),
        },
      };
    },

    timeBlocks: async (parent, { trackedTaskId }, { models, me }) => {
      return await models.TimeBlock.findAll({
        where: {
          trackedtaskId: trackedTaskId,
        },
      });
    },
    chargeCodes: async (parent, {}, { models }) => {
      return await models.ChargeCode.findAll();
    },
    trackedTasks: async (
      parent,
      { trackedDayId, cursor, limit = 1000 },
      { models, me }
    ) => {
      const cursorOptions = cursor
        ? {
            where: {
              createdAt: {
                [Sequelize.Op.lt]: new Date(
                  Number.parseInt(fromCursorHash(cursor))
                ),
              },
              trackeddayId: trackedDayId,
            },
            include: [
              {
                model: models.TrackedDay,
                required: true,
                where: {
                  userId: me.id,
                },
              },
            ],
          }
        : {
            where: {
              trackeddayId: trackedDayId,
            },
            include: [
              {
                model: models.TrackedDay,
                required: true,
                where: {
                  userId: me.id,
                },
              },
            ],
          };
      const trackedTasks = await models.TrackedTask.findAll({
        order: [["createdAt", "DESC"]],
        limit: limit + 1,
        ...cursorOptions,
      });

      const hasNextPage = trackedTasks.length > limit;
      const edges = hasNextPage ? trackedTasks.slice(0, -1) : trackedTasks;

      return {
        edges: edges,
        pageInfo: {
          hasNextPage,
          endCursor: calculateEndCursor(edges),
        },
      };
    },
  },
  Mutation: {
    createTrackedDay: combineResolvers(
      isAuthenticated,
      async (parent, { date, mode }, { me, models }) => {
        const trackedDay = await models.TrackedDay.create({
          date: new Date(date),
          mode,
          userId: me.id,
        });

        // TODO tie up the timesheet here

        // pubsub.publish(EVENTS.TRACKER.CREATED_TRACKEDDAY, {
        //   trackedDayCreated: { trackedDay },
        // });
        return trackedDay;
      }
    ),
    updateTrackedDay: combineResolvers(
      isAuthenticated,
      isTrackedDayOwner,
      async (parent, { id, date, mode }, { models }) => {
        const trackedDay = await models.TrackedDay.findByPk(id);
        if (date) {
          trackedDay.date = new Date(date);
        }
        if (mode) {
          trackedDay.mode = mode;
        }
        await trackedDay.save();
        return trackedDay;
      }
    ),
    createTrackedTask: combineResolvers(
      isAuthenticated,
      async (
        parent,
        { trackedDayId, notes, chargeCodeIds },
        { me, models }
      ) => {
        const trackedDay = await models.TrackedDay.findByPk(trackedDayId);
        if (trackedDay && trackedDay.userId === me.id) {
          const trackedTask = await models.TrackedTask.create({
            notes,
            trackeddayId: trackedDay.id,
          });

          if (chargeCodeIds) {
            const chargeCodes = await models.ChargeCode.findAll({
              where: {
                id: chargeCodeIds,
              },
            });

            await trackedTask.setChargecodes(chargeCodes);
          }

          return trackedTask;
        } else {
          throw new ForbiddenError(
            "Cannot create Task for Day that is not yours."
          );
        }
      }
    ),
    updateTrackedTask: combineResolvers(
      isAuthenticated,
      isTrackedTaskOwner,
      async (parent, { id, notes, chargeCodeIds }, { me, models }) => {
        const trackedTask = await models.TrackedTask.findByPk(id);

        const previousChargeCodes = await trackedTaskChargeCodes(
          models,
          trackedTask.id
        );

        let chargeCodes = [];
        if (chargeCodeIds && chargeCodeIds.length) {
          chargeCodes = await models.ChargeCode.findAll({
            where: {
              id: chargeCodeIds,
            },
          });
        }

        if (notes !== undefined) {
          trackedTask.notes = notes;
        }

        let codesChanged = false;
        if (chargeCodeIds !== undefined) {
          codesChanged = true;
          await trackedTask.setChargecodes(chargeCodes);
          // const again = await trackedTaskChargeCodes(models, trackedTask.id);
        }
        await trackedTask.save();

        if (codesChanged) {
          const trackedDay = await models.TrackedDay.findByPk(
            trackedTask.trackeddayId
          );
          await updateTimesheetCodeChanges(
            models,
            trackedDay,
            previousChargeCodes
            // chargeCodes
          );
        }

        return trackedTask;
      }
    ),
    createChargeCode: combineResolvers(
      isAuthenticated,
      async (parent, { name, code, expired, description }, { me, models }) => {
        const chargeCode = await models.ChargeCode.create({
          name,
          code,
          expired,
          description,
        });

        return chargeCode;
      }
    ),
    updateChargeCode: combineResolvers(
      isAuthenticated,
      async (parent, { id, name, code, expired, description }, { models }) => {
        const chargeCode = await models.ChargeCode.findByPk(id);
        if (name) {
          chargeCode.name = name;
        }
        if (code) {
          chargeCode.code = code;
        }
        if (expired !== null && expired !== undefined) {
          chargeCode.expired = expired;
        }
        if (description !== undefined) {
          chargeCode.description = description;
        }
        await chargeCode.save();
        return chargeCode;
      }
    ),
    createTimeBlock: combineResolvers(
      isAuthenticated,
      async (parent, { trackedTaskId, startTime, minutes }, { me, models }) => {
        const trackedTask = await models.TrackedTask.findByPk(trackedTaskId);

        // TODO add TIMESHEET subscription here
        if (trackedTask) {
          const trackedDay = await models.TrackedDay.findByPk(
            trackedTask.trackeddayId
          );
          if (trackedDay && trackedDay.userId === me.id) {
            const timeBlock = await models.TimeBlock.create({
              trackedtaskId: trackedTaskId,
              startTime,
              minutes,
            });

            await updateTimesheet(models, trackedDay, trackedTask);

            return timeBlock;
          } else {
            throw new ForbiddenError(
              "Cannot create Time Block for Day that is not yours."
            );
          }
        } else {
          throw new ForbiddenError("Could not find TrackedTask to attach to.");
        }
      }
    ),
    updateTimeBlock: combineResolvers(
      isAuthenticated,
      async (parent, { id, minutes }, { models }) => {
        const timeBlock = await models.TimeBlock.findByPk(id);
        timeBlock.minutes = minutes;
        await timeBlock.save();
        return timeBlock;
      }
    ),
    deleteTrackedDay: combineResolvers(
      isAuthenticated,
      isTrackedDayOwner,
      async (parent, { id }, { models }) => {
        const result = await models.TrackedDay.destroy({ where: { id } });

        // pubsub.publish(EVENTS.TRACKER.DELETED_TRACKEDDAY, {
        //   trackedDayDeleted: { id },
        // });
        if (result) {
          return id;
        } else {
          return null;
        }
      }
    ),
    deleteTimeBlock: combineResolvers(
      isAuthenticated,
      async (parent, { id }, { models }) => {
        const timeBlock = await models.TimeBlock.findByPk(id);
        if (timeBlock) {
          const trackedTask = await models.TrackedTask.findByPk(
            timeBlock.trackedtaskId
          );
          const trackedDay = await models.TrackedDay.findByPk(
            trackedTask.trackeddayId
          );

          await updateTimesheet(models, trackedDay, trackedTask, false);

          const result = await models.TimeBlock.destroy({ where: { id } });
          if (result) {
            return id;
          }
        }
        return null;
      }
    ),
    deleteTrackedTask: combineResolvers(
      isAuthenticated,
      isTrackedTaskOwner,
      async (parent, { id }, { models }) => {
        const previousChargeCodes = await trackedTaskChargeCodes(models, id);

        const trackedTask = await models.TrackedTask.findByPk(id);
        const trackedDay = await models.TrackedDay.findByPk(
          trackedTask.trackeddayId
        );

        const result = await models.TrackedTask.destroy({ where: { id } });

        await updateTimesheetCodeChanges(
          models,
          trackedDay,
          previousChargeCodes
          // []
        );

        if (result) {
          return id;
        } else {
          return null;
        }
      }
    ),
  },
  Subscription: {
    timesheetUpdated: {
      subscribe: () => pubsub.asyncIterator(EVENTS.TRACKER.UPDATED_TIMESHEET),
    },
  },
  TrackedDay: {
    user: async (trackedDay, args, { loaders }) => {
      return await loaders.user.load(trackedDay.userId);
    },
    tasks: async (trackedDay, args, { models }) => {
      return await models.TrackedTask.findAll({
        where: {
          trackeddayId: trackedDay.id,
        },
      });
    },
    date: async (trackedDay) => {
      return trackedDay.date.getTime();
    },
  },
  TimeBlock: {
    startTime: async (timeBlock) => {
      return timeBlock.startTime.getTime();
    },
  },
  TimeCharge: {
    date: async (timeCharge) => {
      return timeCharge.date.getTime();
    },
    chargeCode: async (timeCharge, args, { models }) => {
      return await models.ChargeCode.findByPk(timeCharge.chargecodeId);
    },
  },
  Timesheet: {
    weekEndingDate: async (timesheet) => {
      return timesheet.weekEndingDate.getTime();
    },
    trackedDays: async (timesheet, args, { models }) => {
      return await models.TrackedDay.findAll({
        where: {
          timesheetId: timesheet.id,
        },
      });
    },
    timeCharged: async (timesheet, args, { models }) => {
      return await models.TimeCharge.findAll({
        where: {
          timesheetId: timesheet.id,
        },
      });
    },
  },
  TrackedTask: {
    createdAt: async (trackedTask) => {
      return trackedTask.createdAt.getTime();
    },
    chargeCodes: async (trackedTask, args, { models }) => {
      return await trackedTaskChargeCodes(models, trackedTask.id);
    },
    timeBlocks: async (trackedTask, args, { models }) => {
      return await models.TimeBlock.findAll({
        where: {
          trackedtaskId: trackedTask.id,
        },
      });
    },
  },
};
