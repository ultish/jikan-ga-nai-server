import Sequelize from 'sequelize';
import { combineResolvers } from 'graphql-resolvers';
import { isAuthenticated, isMessageOwner } from './authorization';

import pubsub, { EVENTS } from '../subscriptions';

export default {
  Mutation: {
    createTrackedDay: combineResolvers(
      isAuthenticated,
      async (parent, { date, mode }, { me, models }) => {
        debugger;
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
  },
  TrackedDay: {
    user: async (trackedDay, args, { loaders }) => {
      return await loaders.user.load(trackedDay.userId);
    },
  },
};
