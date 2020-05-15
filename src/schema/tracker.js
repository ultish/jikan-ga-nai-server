import { gql } from "apollo-server-express";

export default gql`
  enum DayMode {
    NORMAL
    HOL_PUBLIC
    HOL_PERSONAL
    HOL_RDO
    HOL_ANNUAL
  }

  type Timesheet {
    id: ID!
    weekEndingDate: Float!
    timeCharged: [TimeCharge!]!
    user: User!
    trackedDays: [TrackedDay!]!
  }
  type TimeCharge {
    id: ID!
    date: Float!
    chargeCode: ChargeCode!
    value: Float!
  }
  type TimeSlotCharge {
    id: ID!
    chargeCode: ChargeCode!
    value: Int!
    timeSlot: TimeSlot!
  }
  type TimeSlot {
    id: ID!
    date: Float!
    counter: Int!
    timeBlocks: [TimeBlock!]
    timeSlotCharges: [TimeSlotCharge!]
  }
  type TrackedTask {
    id: ID!
    notes: String
    chargeCodes: [ChargeCode!]
    timeBlocks: [TimeBlock!]
    createdAt: Float!
    overtimeEnabled: Boolean!
    valuePerChargeCode: Int # counts value per ChargeCode eg 15/#chargeCodes
    valueOfTask: Int # counts number of TimeBlocks for this task
  }
  type TrackedDay {
    id: ID!
    date: Float!
    mode: DayMode!
    tasks: [TrackedTask!]
    user: User!
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
    startTime: Float!
    minutes: Int
    timeSlot: TimeSlot!
  }
  type TrackedDayPaginated {
    edges: [TrackedDay!]!
    pageInfo: PageInfo!
  }
  type TrackedTasksPaginated {
    edges: [TrackedTask!]!
    pageInfo: PageInfo!
  }

  extend type Query {
    trackedDays(cursor: String, limit: Int): TrackedDayPaginated!
    trackedDay(trackedDayId: ID!): TrackedDay!
    trackedTasks(
      trackedDayId: ID!
      cursor: String
      limit: Int
    ): TrackedTasksPaginated!
    timeBlocks(trackedTaskId: ID!): [TimeBlock!]!
    chargeCodes: [ChargeCode!]!
    timesheet(trackedDayId: ID!): Timesheet
  }
  extend type Mutation {
    createTrackedDay(date: Float!, mode: DayMode!): TrackedDay!
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
      startTime: Float!
      minutes: Int
    ): TimeBlock!

    updateTrackedDay(id: ID!, date: Float, mode: DayMode): TrackedDay!
    updateTrackedTask(id: ID!, notes: String, chargeCodeIds: [ID]): TrackedTask!
    updateChargeCode(
      id: ID!
      name: String
      code: String
      expired: Boolean
      description: String
    ): ChargeCode!
    updateTimeBlock(id: ID!, minutes: Int!): TimeBlock!

    deleteTrackedDay(id: ID!): ID
    deleteTrackedTask(id: ID!): ID
    deleteTimeBlock(id: ID!): ID
  }

  extend type Subscription {
    timesheetUpdated: Timesheet
  }
`;
