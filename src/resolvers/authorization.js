import { ForbiddenError } from "apollo-server";
import { combineResolvers, skip } from "graphql-resolvers";

export const isAuthenticated = (parent, args, { me }) =>
  me ? skip : new ForbiddenError("Not authenticated user.");

export const isMessageOwner = async (parent, { id }, { models, me }) => {
  const message = await models.Message.findByPk(id, { raw: true });
  if (message.userId !== me.id) {
    throw new ForbiddenError("Not authenticated as owner.");
  }
  return skip;
};

export const isTrackedDayOwner = async (parent, { id }, { models, me }) => {
  const trackedDay = await models.TrackedDay.findByPk(id, { raw: true });
  if (trackedDay.userId !== me.id) {
    throw new ForbiddenError("Not your Tracked Day.");
  }
  return skip;
};

export const isTrackedTaskOwner = async (parent, { id }, { models, me }) => {
  const trackedTask = await models.TrackedTask.findByPk(id);
  if (trackedTask) {
    const trackedDay = await models.TrackedDay.findByPk(
      trackedTask.trackeddayId,
      { raw: true }
    );
    if (trackedDay.userId !== me.id) {
      throw new ForbiddenError("Not your Tracked Task.");
    }
  }
  return skip;
};

export const isAdmin = combineResolvers(
  isAuthenticated,
  (parent, args, { me: { role } }) => {
    return role === "ADMIN"
      ? skip
      : new ForbiddenError("Not authorized as admin.");
  }
);
