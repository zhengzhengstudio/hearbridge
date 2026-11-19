'use strict';

/**
 * 前哨站建筑内玩法「地基」回归测试。
 * 验证任务板 / 交易 / 设施 / 校准改装的确定性规则，以及存档回退与幂等。
 * 必须通过 npm run test:simulation 提供 SPACEFIGHT_COCOS_COMPILED_CORE。
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const compiledCoreRoot = process.env.SPACEFIGHT_COCOS_COMPILED_CORE;
assert.ok(compiledCoreRoot, 'Run this suite through npm run test:simulation');
const {
  StationSystem,
  parseStationSave,
  defaultStationSave,
  CONTRACTS,
  TRADE_GOODS,
  FACILITIES,
} = require(path.join(compiledCoreRoot, 'StationSystem.js'));

/** 内存存档，模拟 sys.localStorage。 */
function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    raw: map,
  };
}

/** 假经济端口：真扣真发，记录 receipt 做幂等。 */
function makeEconomy(tickets = 1000) {
  const state = { tickets, receipts: new Set(), grants: 0, spends: 0 };
  return {
    state,
    getTickets: () => state.tickets,
    spendTickets: (amount, receipt) => {
      if (!receipt || state.receipts.has(receipt) || state.tickets < amount) return false;
      state.receipts.add(receipt);
      state.tickets -= amount;
      state.spends += 1;
      return true;
    },
    grantTickets: (amount, receipt) => {
      if (!receipt || state.receipts.has(receipt)) return false;
      state.receipts.add(receipt);
      state.tickets += amount;
      state.grants += 1;
      return true;
    },
  };
}

test('存档解析：空值/损坏退回默认，缺字段逐项补齐', () => {
  assert.deepEqual(parseStationSave(null), defaultStationSave());
  assert.deepEqual(parseStationSave('{bad json'), defaultStationSave());
  const partial = parseStationSave(JSON.stringify({ holdings: { ore: 5 }, trips: 3, priceSeed: -2 }));
  assert.equal(partial.holdings.ore, 5);
  assert.equal(partial.holdings.data, 0, '缺失商品补 0');
  assert.equal(partial.trips, 3);
  assert.equal(partial.version, 1);
});

test('任务板：接取→推进→可领→领奖，只发一次券', () => {
  const storage = makeStorage();
  const economy = makeEconomy();
  const station = new StationSystem(storage, economy);
  const purge = CONTRACTS.find((c) => c.kind === 'purge');
  assert.ok(station.availableContracts().some((c) => c.id === purge.id));
  assert.equal(station.acceptContract(purge.id).ok, true);
  assert.equal(station.acceptContract(purge.id).ok, false, '重复接取被拒');

  station.recordTrip({ kills: 4, cargoValue: 0 });
  assert.equal(station.snapshot().contracts.find((c) => c.id === purge.id).status, 'active');
  station.recordTrip({ kills: 6, cargoValue: 0 });
  assert.equal(station.snapshot().contracts.find((c) => c.id === purge.id).status, 'ready');

  const before = economy.getTickets();
  const claim = station.claimContract(purge.id);
  assert.equal(claim.ok, true);
  assert.equal(claim.value, purge.reward);
  assert.equal(economy.getTickets(), before + purge.reward);
  assert.equal(station.claimContract(purge.id).ok, false, '重复领奖被拒（幂等）');
});

test('任务进度按 kind 取不同指标：escort 按趟、delivery 按货值', () => {
  const storage = makeStorage();
  const station = new StationSystem(storage, makeEconomy());
  const escort = CONTRACTS.find((c) => c.kind === 'escort');
  const delivery = CONTRACTS.find((c) => c.kind === 'delivery');
  station.acceptContract(escort.id);
  station.acceptContract(delivery.id);
  station.recordTrip({ kills: 99, cargoValue: 0 });
  assert.equal(station.snapshot().contracts.find((c) => c.id === escort.id).progress, 1, 'escort 只按趟数+1');
  station.recordTrip({ kills: 0, cargoValue: 130 });
  assert.equal(station.snapshot().contracts.find((c) => c.id === delivery.id).progress, 130, 'delivery 按货值累加');
});

test('交易：买扣券加库存，卖加券减库存，库存不足被拒', () => {
  const storage = makeStorage();
  const economy = makeEconomy(1000);
  const station = new StationSystem(storage, economy);
  const before = economy.getTickets();
  const buy = station.buy('ore', 2);
  assert.equal(buy.ok, true);
  assert.equal(station.snapshot().holdings.ore, 2);
  assert.equal(economy.getTickets(), before - buy.value);

  assert.equal(station.sell('ore', 5).ok, false, '卖出超过库存被拒');
  const sell = station.sell('ore', 1);
  assert.equal(sell.ok, true);
  assert.equal(station.snapshot().holdings.ore, 1);
  assert.equal(economy.getTickets(), before - buy.value + sell.value);
});

test('交易：同一趟内连续买/卖多次都成功（receipt 幂等不误挡正常交易）', () => {
  const storage = makeStorage();
  const economy = makeEconomy(1000);
  const station = new StationSystem(storage, economy);
  const startTickets = economy.getTickets();
  // 同一趟（trips 不变）连续买三次矿石：旧版 nextReceipt 会重复导致第 2、3 次失败。
  assert.equal(station.buy('ore', 1).ok, true);
  assert.equal(station.buy('ore', 1).ok, true);
  assert.equal(station.buy('ore', 1).ok, true);
  assert.equal(station.snapshot().holdings.ore, 3);
  assert.ok(economy.getTickets() < startTickets, '三次买入都应扣券');
  // 连续卖三次也都要成功。
  assert.equal(station.sell('ore', 1).ok, true);
  assert.equal(station.sell('ore', 1).ok, true);
  assert.equal(station.sell('ore', 1).ok, true);
  assert.equal(station.snapshot().holdings.ore, 0);
});

test('交易：买价高于卖价，行情刷新改变价格', () => {
  const station = new StationSystem(makeStorage(), makeEconomy());
  const market1 = station.market();
  for (const good of TRADE_GOODS) {
    assert.ok(market1[good.id].buy > market1[good.id].sell, `${good.id} 应有价差`);
  }
  station.refreshMarket();
  const market2 = station.market();
  assert.notDeepEqual(market2, market1, '刷新后行情应变化');
});

test('交易：同一趟重开应用仍能买卖，非有限数量不会动到库存或券', () => {
  const storage = makeStorage();
  const economy = makeEconomy();
  const first = new StationSystem(storage, economy);
  assert.equal(first.buy('ore').ok, true);
  const reopened = new StationSystem(storage, economy);
  assert.equal(reopened.buy('ore').ok, true);
  const balance = economy.getTickets();
  for (const quantity of [NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.equal(reopened.buy('ore', quantity).ok, false);
    assert.equal(reopened.sell('ore', quantity).ok, false);
  }
  assert.equal(economy.getTickets(), balance);
  assert.equal(reopened.snapshot().holdings.ore, 2);
});

test('设施互动：氛围设施不刷券，收益设施按冷却给券', () => {
  const storage = makeStorage();
  const economy = makeEconomy(1000);
  const station = new StationSystem(storage, economy);
  const rewardFac = FACILITIES.find((f) => f.ticketReward > 0);
  const before = economy.getTickets();
  const first = station.interactFacility(rewardFac.id);
  assert.equal(first.ok, true);
  assert.equal(first.value, rewardFac.ticketReward, '首次互动给券');
  assert.ok(station.snapshot().visited.includes(rewardFac.id));

  const second = station.interactFacility(rewardFac.id);
  assert.equal(second.value, 0, '冷却内再互动不给券');
  assert.equal(economy.getTickets(), before + rewardFac.ticketReward, '只发一次');
});

test('校准改装：低准度失败不扣券，高准度成功可累计', () => {
  const storage = makeStorage();
  const economy = makeEconomy(1000);
  const station = new StationSystem(storage, economy);
  const before = economy.getTickets();
  assert.equal(station.completeRefit(20).ok, false, '低准度失败');
  assert.equal(economy.getTickets(), before, '失败不扣券');
  assert.equal(station.completeRefit(85).ok, true);
  assert.equal(station.snapshot().refitCount, 1);
  assert.equal(station.snapshot().refitBest, 85);
  assert.ok(economy.getTickets() < before, '成功扣券');
  const after = economy.getTickets();
  const reopened = new StationSystem(storage, economy);
  assert.equal(reopened.shieldCapacityBonus(), 17);
  assert.equal(reopened.completeRefit(101).reason, 'calibration-failed');
  assert.equal(reopened.completeRefit(85).reason, 'no-improvement');
  assert.equal(economy.getTickets(), after);
  assert.equal(reopened.completeRefit(100).ok, true);
  assert.equal(reopened.shieldCapacityBonus(), 20);
});

test('存档持久化：新建实例读回同一份状态', () => {
  const storage = makeStorage();
  const economy = makeEconomy(1000);
  const first = new StationSystem(storage, economy);
  first.acceptContract(CONTRACTS[0].id);
  first.buy('alloy', 3);
  first.interactFacility('bridge');
  const second = new StationSystem(storage, economy);
  assert.deepEqual(second.snapshot(), first.snapshot(), '重启后状态一致');
});
