/**
 * Dependency Injection types.
 * Re-exports from container and tokens for backward compatibility.
 */

export type { Container, Factory, Lifecycle } from "./container.js";
export { createToken, type Token } from "./tokens.js";
