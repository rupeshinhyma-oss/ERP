import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Automatically cleanup rendered DOM trees after each test run
afterEach(() => {
  cleanup();
});
