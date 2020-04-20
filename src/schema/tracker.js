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
    date: Date!
    mode: DayMode!
    tasks: [TrackedTask!]
    user: User!
  }
  type TrackedTask {
    notes: String
    chargeCodes: [ChargeCode!]
    timeBlocks: [TimeBlock!]
  }
  type ChargeCode {
    name: String!
    code: String!
    description: String
    expired: Boolean!
  }
  type TimeBlock {
    startTime: Date!
    minutes: Int
  }

  extend type Query {
    trackedDays: [TrackedDay!]
  }
  extend type Mutation {
    createTrackedDay(date: Date!, mode: DayMode): TrackedDay!
    deleteTrackedDay(id: ID!): Boolean!
  }
`;
