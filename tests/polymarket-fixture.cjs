"use strict";
module.exports = function fixture(now = Date.now()) {
  const future = new Date(now + 86400000).toISOString(), fetched = new Date(now - 60000).toISOString();
  const event = id => ({id:String(id), slug:"synthetic-event-"+id, title:"Synthetic event " + id,
    url:"https://polymarket.com/event/synthetic-event-"+id, volume:1000000*id, volume_24h:10000*id, ends_at:future,
    outcomes:[{label:"Scenario A", probability:.65, market_id:String(id*10), ends_at:future},
      {label:"Scenario B", probability:.25, market_id:String(id*10+1), ends_at:future}]});
  return {schema_version:1, kind:"polymarket_events", provider:"polymarket", generated_at:fetched,
    groups:{finance:{ranking:"volume", fetch_status:"fresh", fetched_at:fetched, events:[event(1),event(2),event(3)]},
      popular:{ranking:"volume24hr", fetch_status:"fresh", fetched_at:fetched, events:[event(4),event(5)]}}};
};
