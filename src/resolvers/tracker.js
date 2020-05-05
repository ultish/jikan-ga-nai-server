import Sequelize from 'sequelize';
import { combineResolvers } from 'graphql-resolvers';
import {
  isAuthenticated,
  isMessageOwner,
  isTrackedDayOwner,
  isTrackedTaskOwner,
} from './authorization';
import { ForbiddenError } from 'apollo-server';

import pubsub, { EVENTS } from '../subscriptions';
import chargecode from '../models/chargecode';

import { toCursorHash, fromCursorHash } from './message';

import moment from 'moment';

// how many minutes each time block represents
const TIMEBLOCK_DURATION = 15;

const calculateEndCursor = (edges) => {
  if (edges && edges.length) {
    return toCursorHash(edges[edges.length - 1].createdAt.getTime().toString());
  } else {
    return '';
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

const updateTimesheetCodeChanges = async (trackedTask, chargeCodes) => {
  /*
  when code changes for a task, we need to wipe all TimeCharged for
  this task and re-create them  
  */
};

const updateTimesheet = async (
  models,
  trackedDay,
  trackedTask,
  timeBlock,
  increment = true
) => {
  debugger;
  // find the timesheet first
  if (!trackedDay.timesheetId) {
    console.error('No timesheet for TrackedDay: ' + trackedDay.id);
    return;
  }

  debugger;

  const timesheet = await models.Timesheet.findByPk(trackedDay.timesheetId);

  debugger;

  if (timesheet) {
    const chargeCodes = await trackedTaskChargeCodes(
      models,
      trackedTask.id,
      trackedDay.id
    );

    if (chargeCodes.length) {
      debugger;
      // not creating any ChargedTime without charge codes
      const timeCharges = await fetchTimeCharges(
        models,
        trackedDay,
        timesheet.id,
        chargeCodes.map((cc) => cc.id)
      );

      debugger;

      // for each timeCharges, add a bit of time
      let toIncrement = TIMEBLOCK_DURATION / timeCharges.length;
      if (!increment) {
        toIncrement = toIncrement * -1;
      }
      for (let timeCharge of timeCharges) {
        timeCharge.value = Math.max(0, timeCharge.value + toIncrement);
        await timeCharge.save();
      }
    }
  } else {
    console.error('Could not find Timesheet: ' + trackedDay.timesheetId);
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
  debugger;

  const existingTimeCharges = await models.TimeCharge.findAll({
    where: {
      timesheetId: timesheetId,
      trackeddayId: trackedDay.id,
      chargecodeId: {
        [Sequelize.Op.in]: chargeCodeIds,
      },
    },
  });

  debugger;

  const result = [...existingTimeCharges];
  if (chargeCodeIds.length !== existingTimeCharges.length) {
    const existingChargeCodeIds = existingTimeCharges.map(
      (tc) => tc.chargecodeId
    );

    // something missing, create them
    const missingChargeCodes = chargeCodeIds.filter(
      (id) => !existingChargeCodeIds.includes(id)
    );
    debugger;

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

  debugger;

  return result;
};

const trackedTaskChargeCodes = async (models, trackedTaskId) => {
  return await models.ChargeCode.findAll({
    include: [
      {
        model: models.TrackedTask,
        through: 'taskcodes',
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
          endOfWeek = moment.endOf('year').startOf('day');
        } else {
          endOfWeek = date.clone().endOf('isoweek').startOf('day');
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
          trackedDay.timesheetId = timesheet.id;
          trackedDay = await trackedDay.save();

          return timesheet;
        } else {
          return timesheet[0];
        }
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
        order: [['createdAt', 'DESC']],
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
        order: [['createdAt', 'DESC']],
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
            'Cannot create Task for Day that is not yours.'
          );
        }
      }
    ),
    updateTrackedTask: combineResolvers(
      isAuthenticated,
      isTrackedTaskOwner,
      async (parent, { id, notes, chargeCodeIds }, { me, models }) => {
        const trackedTask = await models.TrackedTask.findByPk(id);

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
        }
        await trackedTask.save();

        if (codesChanged) {
          updateTimesheetCodeChanges(trackedTask, chargeCodes);
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

            updateTimesheet(models, trackedDay, trackedTask, timeBlock);

            return timeBlock;
          } else {
            throw new ForbiddenError(
              'Cannot create Time Block for Day that is not yours.'
            );
          }
        } else {
          throw new ForbiddenError('Could not find TrackedTask to attach to.');
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

          updateTimesheet(models, trackedDay, trackedTask, timeBlock, false);

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
        const result = await models.TrackedTask.destroy({ where: { id } });
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
