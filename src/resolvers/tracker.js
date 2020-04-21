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

export default {
  Mutation: {
    createTrackedDay: combineResolvers(
      isAuthenticated,
      async (parent, { date, mode }, { me, models }) => {
        const trackedDay = await models.TrackedDay.create({
          date,
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
          trackedDay.date = date;
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
        return result;
      }
    ),
    deleteTimeBlock: combineResolvers(
      isAuthenticated,
      async (parent, { id }, { models }) => {
        const result = await models.TimeBlock.destroy({ where: { id } });

        return result;
      }
    ),
    deleteTrackedTask: combineResolvers(
      isAuthenticated,
      isTrackedTaskOwner,
      async (parent, { id }, { models }) => {
        const result = await models.TrackedTask.destroy({ where: { id } });

        return result;
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
  },
  TrackedTask: {
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
