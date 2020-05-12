const trackedDay = (sequelize, DataTypes) => {
  const TrackedDay = sequelize.define(
    "trackedday",
    {
      date: {
        type: DataTypes.DATE,
        allowNull: false,
        unique: true,
        validate: {
          notEmpty: true,
        },
      },
      mode: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notEmpty: true,
        },
      },
    },
    {
      indexes: [
        {
          fields: ["userId"],
        },
        {
          fields: ["timesheetId"],
        },
      ],
    }
  );

  TrackedDay.associate = (models) => {
    TrackedDay.hasMany(models.TrackedTask, {
      onDelete: "CASCADE",
      hooks: true,
    });
    TrackedDay.belongsTo(models.User);
    TrackedDay.hasMany(models.TimeCharge, { onDelete: "CASCADE", hooks: true });
  };

  return TrackedDay;
};
export default trackedDay;
