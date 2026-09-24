import { Module } from "@medusajs/framework/utils"
import SparkyModuleService from "./service"

export const SPARKY_MODULE = "sparky"

export default Module(SPARKY_MODULE, {
  service: SparkyModuleService,
})
