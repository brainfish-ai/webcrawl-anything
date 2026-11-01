import { test } from "node:test";
import assert from "node:assert/strict";
import {
  markDomainProxyNeeded,
  isDomainProxyNeeded,
  registerExternalSessionStore,
  resetSessionStateForTests,
  PROXY_MEMO_TTL_MS,
} from "../engine/session.js";
import { residentialProxyUrl, lastFetchTier, lastProxyBytesCount } from "../engine/fetcher.js";

test("residentialProxyUrl resolves DECODO_URL directly", () => {
  const prev = process.env.DECODO_URL;
  const prevUser = process.env.DECODO_USER;
  const prevPwd = process.env.DECODO_PWD;
  try {
    process.env.DECODO_URL = "http://u:p@gate.decodo.com:7000";
    process.env.DECODO_USER = "other";
    process.env.DECODO_PWD = "x";
    assert.equal(residentialProxyUrl(), "http://u:p@gate.decodo.com:7000");
    delete process.env.DECODO_URL;
    assert.equal(
      residentialProxyUrl(),
      "http://other:x@gate.decodo.com:7000"
    );
    // user needs URL-encoding when it carries reserved chars
    process.env.DECODO_USER = "user name";
    assert.equal(
      residentialProxyUrl(),
      "http://user%20name:x@gate.decodo.com:7000"
    );
    delete process.env.DECODO_USER;
    delete process.env.DECODO_PWD;
    assert.equal(residentialProxyUrl(), null);
  } finally {
    if (prev === undefined) delete process.env.DECODO_URL;
    else process.env.DECODO_URL = prev;
    if (prevUser === undefined) delete process.env.DECODO_USER;
    else process.env.DECODO_USER = prevUser;
    if (prevPwd === undefined) delete process.env.DECODO_PWD;
    else process.env.DECODO_PWD = prevPwd;
  }
});

test("proxy-needed memo marks and expires domains", async () => {
  resetSessionStateForTests();
  assert.equal(await isDomainProxyNeeded("www.stubhub.com"), false);
  await markDomainProxyNeeded("www.stubhub.com");
  assert.equal(await isDomainProxyNeeded("www.stubhub.com"), true);
  assert.equal(await isDomainProxyNeeded("www.expedia.com"), false);
  resetSessionStateForTests();
  assert.equal(await isDomainProxyNeeded("www.stubhub.com"), false);
});

test("proxy-needed memo persists through an external store (optional methods)", async () => {
  resetSessionStateForTests();
  const stored = new Set<string>();
  registerExternalSessionStore({
    getWarmSession: async () => null,
    saveWarmSession: async () => {},
    deleteWarmSession: async () => {},
    markDomainChallenged: async () => {},
    isDomainChallenged: async () => false,
    markDomainProxyNeeded: async (d: string) => {
      stored.add(d);
    },
    isDomainProxyNeeded: async (d: string) => stored.has(d),
  });
  try {
    resetSessionStateForTests(); // clears in-memory, external survives
    assert.equal(await isDomainProxyNeeded("www.stubhub.com"), false);
    // mark through the registered store, then drop in-memory state
    await markDomainProxyNeeded("www.stubhub.com");
    assert.ok(stored.has("www.stubhub.com"));
    resetSessionStateForTests();
    assert.equal(await isDomainProxyNeeded("www.stubhub.com"), true);
    // memo TTL re-arms on external hit so the entry stays hot in-memory
    assert.ok(PROXY_MEMO_TTL_MS >= 60 * 60_000);
  } finally {
    registerExternalSessionStore({
      getWarmSession: async () => null,
      saveWarmSession: async () => {},
      deleteWarmSession: async () => {},
      markDomainChallenged: async () => {},
      isDomainChallenged: async () => false,
    });
    resetSessionStateForTests();
  }
});

test("tier accessors start at the datacenter default with zero proxy bytes", () => {
  assert.equal(lastFetchTier(), "impit-tls");
  assert.equal(lastProxyBytesCount(), 0);
});
