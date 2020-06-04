import Sequelize, { QueryTypes } from "sequelize";

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
import _ from "lodash";

import AsyncLock from "async-lock";
import { sequelize } from "../models";

// how many minutes each time block represents
const TIMEBLOCK_DURATION = 15;

const timeChargeLock = new AsyncLock();

export const calculateEndCursor = (edges, field = "createdAt") => {
  if (edges && edges.length) {
    return toCursorHash(edges[edges.length - 1][field].getTime().toString());
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

const updateTimesheetCodeChanges = async (models, me, trackedDay) => {
  let timesheet = await fetchTimesheet(models, me, trackedDay.id);
  // delete all timecharges on this timesheet so we can start again
  await models.TimeCharge.destroy({
    where: {
      timesheetId: timesheet.id,
    },
  });

  debugger;

  // fetch all tracked days for this timesheet
  const trackedDaysForTimesheet = await models.TrackedDay.findAll({
    where: {
      timesheetId: timesheet.id,
    },
  });

  for (let trackedDayForTimesheet of trackedDaysForTimesheet) {
    // fetch all tracked task IDs for this day
    const trackedTasksForDay = await models.TrackedTask.findAll({
      attributes: ["id"],
      where: {
        trackeddayId: trackedDayForTimesheet.id,
      },
    });
    const trackedTasksIds = trackedTasksForDay.map((tt) => tt.id);

    // find all time blocks for the day
    const allTimeBlocksForTasks = await models.TimeBlock.findAll({
      attributes: ["id", "startTime"],
      where: {
        trackedtaskId: trackedTasksIds,
      },
    });

    // sort and uniq TimeBlocks on the startTime, we don't care about
    // overlapping times as updateTimesheet will deal with them
    const sortedTimeBlocks = _.sortBy(allTimeBlocksForTasks, (tb) =>
      tb.startTime.valueOf()
    );
    const uniqueTimeBlocks = _.sortedUniqBy(sortedTimeBlocks, (tb) =>
      tb.startTime.valueOf()
    );

    debugger;
    for (let timeBlock of uniqueTimeBlocks) {
      await updateTimesheet(
        models,
        me,
        trackedDayForTimesheet,
        timeBlock,
        true,
        true
      );
    }
  }

  pubsub.publish(EVENTS.TRACKER.UPDATED_TIMESHEET, {
    timesheetUpdated: timesheet,
  });
};

/**
 * When a TimeBlock is changed we can't simply evaluate that TimeBlock's
 * TrackedTask for ChargeCodes. We need to look at all TimeBlocks that
 * sit within the same Time Slot as there can be overlapping TimeBlocks
 * within that slot. When this happens, we'll be decreasing other
 * TimeBlock values for other tasks when we create a new TimeBlock, and
 * increase other TimeBlock values when we delete TimeBlocks.
 *
 * So this function will evaluate *all* TimeBlocks given a time slot
 * and update the TimeCharges for all affected Chargecodes that fall
 * on that time slot.
 *
 *
 * a lock is used here as both createTimeBlock and deleteTimeBlock will
 * read from TimeCharged.value and increment/decrement the value. These
 * 2 calls can be called nearly at the same time (drag mouse over blocks)
 * and it will call updateTimesheet together. Now node is single-threaded,
 * but this function is async so there is plenty of chances for node to
 * switch context and continue work elsewhere while it awaits a promise.
 */
const updateTimesheet = async (
  models,
  me,
  trackedDay,
  timeBlock,
  increment = true,
  reset = false
) => {
  // find the timesheet first
  if (!trackedDay.timesheetId) {
    console.error("No timesheet for TrackedDay: " + trackedDay.id);
    return;
  }

  const timesheet = await models.Timesheet.findByPk(trackedDay.timesheetId);

  if (timesheet) {
    // get the 'timecharged' lock
    await timeChargeLock.acquire("timecharged", async () => {
      const timeBlockDate = timeBlock.startTime;

      // for a given date of the timeBlock, we can have overlapping timeBlocks.
      // this affects the amount each block increments/decrements for all
      // timeCharges at this time slot

      // fetch timeBlocks for a given date
      const timeBlocksAtSameTime = await models.TimeBlock.findAll({
        attributes: ["id", "trackedtaskId"],
        where: {
          startTime: timeBlockDate,
          userId: me.id,
        },
      });
      debugger;

      const trackedTaskIds = _.uniq(
        timeBlocksAtSameTime.map((tb) => tb.trackedtaskId)
      );
      debugger;

      let trackedTasks = [];
      if (trackedTaskIds.length) {
        // fetch tracked tasks. Will determine total weight of the timeBlock for all tasks involved.
        trackedTasks = await models.TrackedTask.findAll({
          where: {
            id: trackedTaskIds, // sequelize v5 doesn't need [Sequelize.Op.in]
          },
        });
      }

      const trackedTaskToTimeBlockMap = {};
      timeBlocksAtSameTime.forEach(
        (tb) => (trackedTaskToTimeBlockMap[tb.trackedtaskId] = tb.id)
      );

      // when we delete timeBlocks, we destroy it *after* we run updateTimesheet (this function).
      // So when we are decrementing, the newBlockWeightPerTask is no longer tied to
      // trackedTaskIds.length directly
      let newBlockWeightPerTask, oldBlockWeightPerTask;
      if (increment) {
        newBlockWeightPerTask = TIMEBLOCK_DURATION / trackedTaskIds.length;
        oldBlockWeightPerTask =
          TIMEBLOCK_DURATION / (trackedTaskIds.length - 1) ?? 0;
      } else {
        newBlockWeightPerTask =
          TIMEBLOCK_DURATION / (trackedTaskIds.length - 1) ?? 0;
        oldBlockWeightPerTask = TIMEBLOCK_DURATION / trackedTaskIds.length;
      }

      // this can be negative when incrementing
      const blockWeightPerTaskDiff =
        newBlockWeightPerTask - oldBlockWeightPerTask;

      debugger;

      // TODO trackedTaskIds can be empty
      // fetch charge code ids for each tracked task. Will determine weight of timeBlock for a single task
      let tasksToChargeCodes = [];
      if (trackedTaskIds.length) {
        tasksToChargeCodes = await sequelize.query(
          'select "trackedtaskId", "chargecodeId" from taskcodes where "trackedtaskId" in ( :ids )',
          {
            replacements: {
              ids: trackedTaskIds,
            },
            type: QueryTypes.SELECT,
          }
        );
      }

      // this map will tell us how much each chargecode is worth within a given task
      let chargeCodesForTimeSlot = [];
      const tasksToChargeCodesMap = new Map();
      tasksToChargeCodes.forEach((data) => {
        let values = tasksToChargeCodesMap.get(data.trackedtaskId) ?? [];
        values.push(data.chargecodeId);
        tasksToChargeCodesMap.set(data.trackedtaskId, values);
        chargeCodesForTimeSlot.push(data.chargecodeId);
      });
      chargeCodesForTimeSlot = _.uniq(chargeCodesForTimeSlot);

      if (chargeCodesForTimeSlot.length) {
        // not creating any ChargedTime without charge codes
        const timeCharges = await fetchTimeCharges(
          models,
          trackedDay,
          timesheet.id,
          chargeCodesForTimeSlot
        );

        const timeChargeMap = {};
        timeCharges.forEach((tc) => (timeChargeMap[tc.chargecodeId] = tc));

        // loop through each task on this time slot
        trackedTasks.forEach((trackedTaskForTimeSlot) => {
          debugger;

          let valuePerChargeCode = 0;

          // get the chargecodes
          const chargeCodesForTask =
            tasksToChargeCodesMap.get(trackedTaskForTimeSlot.id) ?? [];

          if (chargeCodesForTask.length) {
            const timeBlockIdForTask =
              trackedTaskToTimeBlockMap[trackedTaskForTimeSlot.id];

            debugger;
            let toIncrementForTask;
            if (reset) {
              // toIncrementForTask = true;
              valuePerChargeCode =
                newBlockWeightPerTask / chargeCodesForTask.length;
            } else {
              // if this is the target block, then it behaves differently
              if (timeBlockIdForTask === timeBlock.id) {
                if (increment) {
                  // adding targeted timeBlock
                  valuePerChargeCode =
                    newBlockWeightPerTask / chargeCodesForTask.length;
                } else {
                  // deleting targeted timeBlock
                  valuePerChargeCode =
                    (oldBlockWeightPerTask / chargeCodesForTask.length) * -1;
                }
              } else {
                // other tasks in the same time slot as targeted timeBlock
                if (increment) {
                  // when we are incrementing, all other blocks will decrease value
                  valuePerChargeCode =
                    blockWeightPerTaskDiff / chargeCodesForTask.length;
                } else {
                  valuePerChargeCode =
                    blockWeightPerTaskDiff / chargeCodesForTask.length;
                }
              }

              debugger;
            }

            chargeCodesForTask.forEach((chargeCodeId) => {
              debugger;
              const timeCharge = timeChargeMap[chargeCodeId];

              timeCharge.value += valuePerChargeCode;
            });
          }
        });

        for (let timeCharge of timeCharges) {
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
  return models.ChargeCode.findAll({
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

const fetchTimesheet = async (models, me, trackedDayId) => {
  let trackedDay = await getTrackedDay(trackedDayId, models, me);
  if (trackedDay) {
    // given this day, work out the week-ending
    const date = moment(trackedDay.date);

    let endOfWeek;
    // TODO special case end of year and start of year scenarios
    if (date.weekYear() !== date.year()) {
      // endOfWeek becomes the last day of the year instead
      endOfWeek = moment().endOf("year").startOf("day");
    } else {
      endOfWeek = date.clone().endOf("isoweek").startOf("day");
    }

    // find timesheet for this endOfWeek
    let timesheet = await models.Timesheet.findAll({
      where: {
        weekEndingDate: endOfWeek.toDate(),
        userId: me.id,
      },
      limit: 1,
    });

    if (!timesheet.length) {
      // create it
      timesheet = await models.Timesheet.create({
        weekEndingDate: endOfWeek.toDate(),
        userId: me.id,
      });
    } else {
      timesheet = timesheet[0];
    }
    trackedDay.timesheetId = timesheet.id;
    await trackedDay.save();
    return timesheet;
  }
  return null;
};

export default {
  Query: {
    timesheet: combineResolvers(
      isAuthenticated,
      async (parent, { trackedDayId }, { models, me }) => {
        return fetchTimesheet(models, me, trackedDayId);
      }
    ),

    trackedDay: async (parent, { trackedDayId }, { models, me }) => {
      return models.TrackedDay.findOne({
        where: {
          id: trackedDayId,
          userId: me.id,
        },
      });
    },

    trackedDays: combineResolvers(
      isAuthenticated,
      async (parent, { cursor, limit = 100 }, { models, me }) => {
        const cursorOptions = cursor
          ? {
              where: {
                date: {
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
            endCursor: calculateEndCursor(edges, "date"),
          },
        };
      }
    ),

    timeBlocks: combineResolvers(
      isAuthenticated,
      async (parent, { trackedTaskId }, { models, me }) => {
        return models.TimeBlock.findAll({
          where: {
            trackedtaskId: trackedTaskId,
          },
        });
      }
    ),
    chargeCodes: async (parent, {}, { models }) => {
      return await models.ChargeCode.findAll();
    },
    trackedTasks: combineResolvers(
      isAuthenticated,
      async (
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
      }
    ),
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
            userId: me.id,
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
          debugger;
          const timeBlocks = await models.TimeBlock.findAll({
            attributes: ["id"],
            where: {
              trackedtaskId: trackedTask.id,
            },
          });
          if (timeBlocks.length) {
            await updateTimesheetCodeChanges(models, me, trackedDay);
          }
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
              userId: me.id,
            });

            await updateTimesheet(
              models,
              me,
              trackedDay,
              // trackedTask,
              timeBlock
            );

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
      async (parent, { id }, { models, me }) => {
        const timeBlock = await models.TimeBlock.findByPk(id);
        if (timeBlock) {
          debugger;

          const trackedTask = await models.TrackedTask.findByPk(
            timeBlock.trackedtaskId
          );
          const trackedDay = await models.TrackedDay.findByPk(
            trackedTask.trackeddayId
          );

          await updateTimesheet(
            models,
            me,
            trackedDay,
            // trackedTask,
            timeBlock,
            false
          );

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
      async (parent, { id }, { models, me }) => {
        const previousChargeCodes = await trackedTaskChargeCodes(models, id);

        const trackedTask = await models.TrackedTask.findByPk(id);
        const trackedDay = await models.TrackedDay.findByPk(
          trackedTask.trackeddayId
        );

        const timeBlocks = await models.TimeBlock.findAll({
          attributes: ["id"],
          where: {
            trackedtaskId: trackedTask.id,
          },
        });
        const hasTimeBlocks = timeBlocks.length > 0;

        const result = await models.TrackedTask.destroy({ where: { id } });

        if (hasTimeBlocks) {
          await updateTimesheetCodeChanges(models, me, trackedDay);
        }

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
