const timeCharge = (sequelize, DataTypes) => {
  const TimeCharge = sequelize.define(
    "timecharge",
    {
      date: {
        type: DataTypes.DATE,
        allowNull: false,
        validate: { notEmpty: true },
      },
      value: {
        type: DataTypes.DOUBLE,
      },
      mode: {
        type: DataTypes.STRING,
      },
    },
    {
      indexes: [
        {
          fields: ["trackeddayId"],
        },

        {
          fields: ["timesheetId"],
        },

        {
          fields: ["chargecodeId"],
        },
        {
          fields: ["date"],
        },
      ],
    }
  );

  TimeCharge.associate = (models) => {
    TimeCharge.belongsTo(models.ChargeCode);
    TimeCharge.belongsTo(models.Timesheet, { onDelete: "CASCADE", hook: true });
    TimeCharge.belongsTo(models.TrackedDay, {
      onDelete: "CASCADE",
      hook: true,
    });
  };

  return TimeCharge;
};
export default timeCharge;
