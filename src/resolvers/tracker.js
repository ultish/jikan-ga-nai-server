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

const calculateEndCursor = (edges) => {
  if (edges && edges.length) {
    return toCursorHash(edges[edges.length - 1].createdAt.getTime().toString());
  } else {
    return '';
  }
};

export default {
  Query: {
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

        trackedTask.notes = notes;
        await trackedTask.setChargecodes(chargeCodes);
        await trackedTask.save();

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
        const result = await models.TimeBlock.destroy({ where: { id } });
        if (result) {
          return id;
        } else {
          return null;
        }
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
  TrackedTask: {
    createdAt: async (trackedTask) => {
      return trackedTask.createdAt.getTime();
    },
    chargeCodes: async (trackedTask, args, { models }) => {
      return await models.ChargeCode.findAll({
        include: [
          {
            model: models.TrackedTask,
            through: 'taskcodes',
            where: {
              id: trackedTask.id,
            },
          },
        ],
      });
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
