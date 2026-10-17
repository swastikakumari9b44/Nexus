import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
// jsdom has no scrollIntoView
Element.prototype.scrollIntoView = () => {};
