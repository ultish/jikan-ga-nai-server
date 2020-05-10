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
      ],
    }
  );

  TimeCharge.associate = (models) => {
    TimeCharge.belongsTo(models.ChargeCode);
  };

  return TimeCharge;
};
export default timeCharge;
