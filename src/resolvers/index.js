import { GraphQLDateTime } from 'graphql-iso-date';
import userResolvers from './user';
import messageResolvers from './message';
import trackerResolvers from './tracker';

const customScalarResolver = {
  Date: GraphQLDateTime,
};
export default [
  customScalarResolver,
  userResolvers,
  messageResolvers,
  trackerResolvers,
];
