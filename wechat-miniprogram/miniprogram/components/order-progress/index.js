const { statusStep } = require("../../utils/format");
Component({ properties: { status: String }, data: { current: -1, steps: ["待接单", "已接单", "制作中", "待取货", "已完成"] }, observers: { status(value) { this.setData({ current: statusStep(value) }); } } });
