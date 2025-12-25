import type { Application } from "express";
import type * as http from "http";
import type { Container } from "inversify";
import type { CommandRepository } from "./command-repository.js";
import type { CommandService } from "../service/index.js";

/**
 * Server startup result
 */
export interface ServerInstance {
	app: Application;
	server: http.Server;
	db: CommandRepository;
	service: CommandService;
	container?: Container;
}
