import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// Increase asyncUtilTimeout to prevent timing flakiness during parallel test runs
configure({ asyncUtilTimeout: 3000 });

// Automatically cleanup rendered DOM trees after each test run
afterEach(() => {
  cleanup();
});
