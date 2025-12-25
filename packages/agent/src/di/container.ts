/**
 * Dependency Injection container implementation using inversify.
 */

import "reflect-metadata";
import { Container as InversifyContainer } from "inversify";
import type { Token } from "./tokens.js";

/**
 * Factory function type for creating instances.
 */
export type Factory<T> = (container: Container) => T;

/**
 * Lifecycle types for registered dependencies.
 */
export type Lifecycle = "singleton" | "transient";

/**
 * Container interface for dependency injection.
 */
export interface Container {
	/**
	 * Register a dependency with singleton lifecycle.
	 * The factory is called once, and the same instance is returned for all resolutions.
	 */
	singleton<T>(token: Token<T>, factory: Factory<T>): void;

	/**
	 * Register a dependency with transient lifecycle.
	 * The factory is called each time the dependency is resolved.
	 */
	transient<T>(token: Token<T>, factory: Factory<T>): void;

	/**
	 * Register a pre-created instance as a singleton.
	 */
	instance<T>(token: Token<T>, value: T): void;

	/**
	 * Resolve a dependency by its token.
	 * @throws Error if the token is not registered.
	 */
	resolve<T>(token: Token<T>): T;

	/**
	 * Check if a token is registered.
	 */
	has<T>(token: Token<T>): boolean;

	/**
	 * Create a child container that inherits from this container.
	 * Useful for scoped registrations (e.g., per-request).
	 */
	createChild(): Container;

	/**
	 * Get the underlying inversify container for advanced usage.
	 */
	getInversifyContainer(): InversifyContainer;
}

/**
 * Inversify-based DI container implementation.
 * Provides a simplified API wrapping inversify's Container.
 */
export class ContainerImpl implements Container {
	private readonly inversifyContainer: InversifyContainer;

	constructor(parentContainer?: InversifyContainer) {
		if (parentContainer) {
			// Create a child container with parent reference
			this.inversifyContainer = new InversifyContainer({
				defaultScope: "Singleton",
				parent: parentContainer,
			});
		} else {
			this.inversifyContainer = new InversifyContainer({
				defaultScope: "Singleton",
			});
		}
	}

	singleton<T>(token: Token<T>, factory: Factory<T>): void {
		this.inversifyContainer
			.bind<T>(token)
			.toDynamicValue(() => factory(this))
			.inSingletonScope();
	}

	transient<T>(token: Token<T>, factory: Factory<T>): void {
		this.inversifyContainer
			.bind<T>(token)
			.toDynamicValue(() => factory(this))
			.inTransientScope();
	}

	instance<T>(token: Token<T>, value: T): void {
		this.inversifyContainer.bind<T>(token).toConstantValue(value);
	}

	resolve<T>(token: Token<T>): T {
		if (!this.has(token)) {
			throw new Error(`No registration found for token: ${token.toString()}`);
		}
		return this.inversifyContainer.get<T>(token);
	}

	has<T>(token: Token<T>): boolean {
		return this.inversifyContainer.isBound(token);
	}

	createChild(): Container {
		return new ContainerImpl(this.inversifyContainer);
	}

	getInversifyContainer(): InversifyContainer {
		return this.inversifyContainer;
	}
}

/**
 * Create a new container instance.
 */
export function createContainer(): Container {
	return new ContainerImpl();
}
