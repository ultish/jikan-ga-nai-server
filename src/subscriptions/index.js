import { PubSub } from "apollo-server";

import * as MESSAGE_EVENTS from "./message";
import * as TRACKER_EVENTS from "./tracker";

export const EVENTS = {
  MESSAGE: MESSAGE_EVENTS,
  TRACKER: TRACKER_EVENTS,
};

export default new PubSub();
