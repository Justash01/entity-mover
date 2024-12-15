import { world } from "@minecraft/server";
import { MovementManager } from "./utils";

world.afterEvents.entitySpawn.subscribe(({ entity }) => {
  if (entity.typeId === "minecraft:item") return;
  const block = entity.dimension.getBlock({ x: entity.location.x, y: entity.location.y - 1, z: entity.location.z });
  const manager = new MovementManager(entity);

  if (block && block.typeId === "minecraft:emerald_block") {
    manager.move("north", 5)
      .move("northeast", 5)
      .move("east", 5)
      .move("southeast", 5)
      .move("south", 5)
      .move("southwest", 5)
      .move("west", 5)
      .move("northwest", 5)
      .start();
  }
});