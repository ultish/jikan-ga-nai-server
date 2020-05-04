import { gql } from 'apollo-server-express';
export default gql`
  extend type Query {
    users: [User!]
    user(id: ID!): User
    me: User
  }
  extend type Mutation {
    signUp(username: String!, password: String!, email: String!): UserToken!
    signIn(login: String!, password: String!): UserToken!
    deleteUser(id: ID!): Boolean!
  }

  type User {
    id: ID!
    username: String!
    email: String!
    role: String
    messages: [Message!]
    trackedDays: [TrackedDay!]
    timesheets: [Timesheet!]
  }

  type UserToken {
    token: String!
    user: User!
  }
`;
