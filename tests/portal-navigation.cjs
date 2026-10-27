"use strict";
// Existing component regressions predate page navigation. Reach a component through the
// actual navigation/select controls before interacting with it; never reveal DOM by force.
// portal-browser.cjs independently tests routing, visibility, focus and compact layouts
// without this helper. Data/calculation assertions in the original suites stay unchanged.
async function componentPage(parent, options) {
  const page = await parent.newPage(options), locate = page.locator.bind(page);
  // Component fixtures own their quotes. Intercept fetch as well as network
  // routing so a live backup cannot replace synthetic prices during a test.
  // Provider recovery tests install their explicit response after this hook.
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => /^(https:\/\/app-money\.tmx\.com\/graphql|https:\/\/raw\.githubusercontent\.com\/osavaria11-bot\/Bourse\/savy-live-quotes\/)/.test(String(input?.url || input)) ?
      Promise.reject(new Error("Direct index provider disabled in component fixtures")) : originalFetch(input, init);
  });
  async function reveal(locator) {
    await locator.first().waitFor({state: "attached"});
    const target = await locator.first().evaluate(node => ({
      panel: node.closest(".portal-panel")?.id,
      page: node.closest(".portal-page")?.dataset.page,
      market: node.closest(".market-card")?.dataset.id,
      macro: node.closest(".indicator-card")?.dataset.id,
    }));
    if (target.page && await locate("#page-" + target.page).isHidden()) await locate('.portal-nav [data-page="' + target.page + '"]').click();
    if (target.panel) {
      const match = /^panel-([^-]+)-(.+)$/.exec(target.panel), [, section, tab] = match;
      if (await locate("#page-" + section).isHidden()) await locate('.portal-nav [data-page="' + section + '"]').click();
      if (await locate("#" + target.panel).isHidden()) await locate('#page-' + section + ' .portal-tabs [data-tab="' + tab + '"]').click();
    }
    if (target.market && await locate('.market-card[data-id="' + target.market + '"]').isHidden()) await locate("#marketSelect").selectOption(target.market);
    if (target.macro && await locate('.indicator-card[data-id="' + target.macro + '"]').isHidden()) {
      if (await locate("#macroCompare").getAttribute("aria-pressed") === "true") await locate("#macroCompare").click();
      await locate("#indicatorSelect").selectOption(target.macro);
    }
  }
  const actions = new Set(["click", "fill", "selectOption", "focus", "press", "hover", "scrollIntoViewIfNeeded", "boundingBox", "screenshot", "setInputFiles"]);
  const chains = new Set(["locator", "first", "last", "nth", "filter", "getByRole", "getByText", "getByLabel"]);
  function wrap(locator) {
    return new Proxy(locator, {get(object, name) {
      if (actions.has(name)) return async (...args) => {await reveal(object); return object[name](...args);};
      if (name === "getByRole") return (role, options) => wrap(object.getByRole(role, {...options, includeHidden: true}));
      if (chains.has(name)) return (...args) => wrap(object[name](...args));
      if (name === "all") return async () => (await object.all()).map(wrap);
      const value = object[name]; return typeof value === "function" ? value.bind(object) : value;
    }});
  }
  page.locator = (...args) => wrap(locate(...args));
  const role = page.getByRole.bind(page); page.getByRole = (name, options) => wrap(role(name, {...options, includeHidden: true}));
  const wait = page.waitForSelector.bind(page);
  page.waitForSelector = async (selector, options = {}) => {
    if (!options.state || options.state === "visible") {await wait(selector, {...options, state: "attached"}); await reveal(locate(selector).first());}
    return wait(selector, options);
  };
  return page;
}
module.exports = {componentPage};
