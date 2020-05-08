const timeCharge = (sequelize, DataTypes) => {
  const TimeCharge = sequelize.define("timecharge", {
    date: {
      type: DataTypes.DATE,
      allowNull: false,
      validate: { notEmpty: true },
    },
    value: {
      type: DataTypes.DOUBLE,
    },
  });

  TimeCharge.associate = (models) => {
    TimeCharge.belongsTo(models.ChargeCode);
  };

  return TimeCharge;
};
export default timeCharge;
