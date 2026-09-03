import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

class ClassList {
  values = new Set();
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class MockElement {
  classList = new ClassList();
  attributes = {};
  hidden = false;
  isConnected = true;
  open = false;
  focusCalls = 0;
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() { this.focusCalls++; }
}

function setup() {
  const elements = new Map();
  const document = {
    activeElement: null,
    querySelector(selector) {
      if (!elements.has(selector)) {
        const element = new MockElement();
        if (selector === "#orderClientSuggestions") element.hidden = true;
        elements.set(selector, element);
      }
      return elements.get(selector);
    },
  };
  const location = { hash: "#admin", pathname: "/", search: "?preview=1" };
  const history = {
    replacement: "",
    replaceState(_state, _title, value) { this.replacement = value; location.hash = ""; },
  };
  const source = readFileSync(new URL("../web/admin.js", import.meta.url), "utf8")
    .replace(/\s*initAdmin\(\);\s*\}\)\(\);\s*$/, "\n  globalThis.ADMIN_TEST = { adminState, adminEls, closeAdmin, handleAdminBackdropClick, handleAdminKeydown };\n})();\n");
  const sandbox = {
    CATALOG_STORE: { loadSettings: () => ({}) },
    document, history, location, HTMLElement: MockElement,
    console, setTimeout, clearTimeout, Blob, URL, Intl,
  };
  vm.runInNewContext(source, sandbox);
  return { ...sandbox.ADMIN_TEST, history, location };
}

test("clicking the backdrop closes Admin and restores focus", () => {
  const app = setup();
  const opener = new MockElement();
  app.adminState.returnFocusElement = opener;
  app.adminEls.adminDrawer.classList.add("is-open");
  app.handleAdminBackdropClick({ target: app.adminEls.adminDrawer });
  assert.equal(app.adminEls.adminDrawer.classList.contains("is-open"), false);
  assert.equal(app.adminEls.adminDrawer.attributes["aria-hidden"], "true");
  assert.equal(app.history.replacement, "/?preview=1");
  assert.equal(opener.focusCalls, 1);
});

test("clicks inside the Admin panel do not close it", () => {
  const app = setup();
  app.adminEls.adminDrawer.classList.add("is-open");
  app.handleAdminBackdropClick({ target: app.adminEls.adminApp });
  assert.equal(app.adminEls.adminDrawer.classList.contains("is-open"), true);
});

test("Escape closes Admin and prevents the browser default", () => {
  const app = setup();
  let prevented = false;
  app.adminEls.adminDrawer.classList.add("is-open");
  app.handleAdminKeydown({ key: "Escape", preventDefault() { prevented = true; } });
  assert.equal(app.adminEls.adminDrawer.classList.contains("is-open"), false);
  assert.equal(prevented, true);
});

test("Escape leaves Admin open while an order-detail dialog is active", () => {
  const app = setup();
  app.adminEls.adminDrawer.classList.add("is-open");
  app.adminEls.adminOrderDialog.open = true;
  app.handleAdminKeydown({ key: "Escape", preventDefault() { throw new Error("must not prevent native dialog close"); } });
  assert.equal(app.adminEls.adminDrawer.classList.contains("is-open"), true);
});

test("unrelated keys and Escape while closed have no effect", () => {
  const app = setup();
  for (const key of ["Enter", "Escape"]) {
    app.handleAdminKeydown({ key, preventDefault() { throw new Error("unexpected preventDefault"); } });
  }
  assert.equal(app.location.hash, "#admin");
});
