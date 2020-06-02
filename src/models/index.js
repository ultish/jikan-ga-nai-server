import Sequelize from "sequelize";

console.log("database: ", process.env.DATABASE);
console.log("user:", process.env.DATABASE_USER);
console.log("dbHost:", process.env.DATABASE_HOSTNAME);
console.log("dbPort:", process.env.DATABASE_PORT);

const sequelize = new Sequelize(
  process.env.DATABASE,
  process.env.DATABASE_USER,
  process.env.DATABASE_PASSWORD,
  {
    // host: "masyu-postgres",
    host: process.env.DATABASE_HOSTNAME || "localhost",
    port: process.env.DATABASE_PORT || 5432,
    dialect: "postgres",
    logging: false,
  }
);

const models = {
  User: sequelize.import("./user"),
  Message: sequelize.import("./message"),
  ChargeCode: sequelize.import("./chargecode"),
  TimeBlock: sequelize.import("./timeBlock"),
  TrackedDay: sequelize.import("./trackedDay"),
  TrackedTask: sequelize.import("./trackedTask"),
  Timesheet: sequelize.import("./timesheet"),
  TimeCharge: sequelize.import("./timeCharge"),
};

Object.keys(models).forEach((key) => {
  if ("associate" in models[key]) {
    models[key].associate(models);
  }
});
export { sequelize };
export default models;
