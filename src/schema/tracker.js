import { gql } from 'apollo-server-express';
export default gql`
  enum DayMode {
    NORMAL
    HOL_PUBLIC
    HOL_PERSONAL
    HOL_RDO
    HOL_ANNUAL
  }
  type TrackedDay {
    id: ID!
    date: Date!
    mode: DayMode!
    tasks: [TrackedTask!]
    user: User!
  }
  type TrackedTask {
    id: ID!
    notes: String
    chargeCodes: [ChargeCode!]
    timeBlocks: [TimeBlock!]
  }
  type ChargeCode {
    id: ID!
    name: String!
    code: String!
    description: String
    expired: Boolean!
  }
  type TimeBlock {
    id: ID!
    startTime: Date!
    minutes: Int
  }

  extend type Query {
    trackedDays: [TrackedDay!]
  }
  extend type Mutation {
    createTrackedDay(date: Date!, mode: DayMode): TrackedDay!
    createTrackedTask(
      trackedDayId: ID!
      notes: String
      chargeCodeIds: [ID]
    ): TrackedTask!
    createChargeCode(
      name: String!
      code: String!
      expired: Boolean!
      description: String
    ): ChargeCode!
    createTimeBlock(
      trackedTaskId: ID!
      startTime: Date!
      minutes: Int
    ): TimeBlock!

    updateTrackedDay(id: ID!, date: Date, mode: DayMode): TrackedDay!
    updateTrackedTask(id: ID!, notes: String, chargeCodeIds: [ID]): TrackedTask!
    updateChargeCode(
      id: ID!
      name: String
      code: String
      expired: Boolean
      description: String
    ): ChargeCode!
    updateTimeBlock(id: ID!, minutes: Int!): TimeBlock!

    deleteTrackedDay(id: ID!): Boolean!
    deleteTrackedTask(id: ID!): Boolean!
    deleteTimeBlock(id: ID!): Boolean!
  }
`;
