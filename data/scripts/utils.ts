import { system, Entity, EntityComponentTypes, EntityMovementComponent } from "@minecraft/server";

export class Vector3 {
  x: number;
  y: number;
  z: number;

  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  scale(factor: number): Vector3 {
    return new Vector3(this.x * factor, this.y * factor, this.z * factor);
  }

  add(vector: Vector3): Vector3 {
    return new Vector3(
      this.x + vector.x, 
      this.y + vector.y, 
      this.z + vector.z
    );
  }

  subtract(vector: Vector3): Vector3 {
    return new Vector3(
      this.x - vector.x, 
      this.y - vector.y, 
      this.z - vector.z
    );
  }

  floor(): Vector3 {
    return new Vector3(
      Math.floor(this.x), 
      Math.floor(this.y), 
      Math.floor(this.z)
    );
  }

  center(): Vector3 {
    return new Vector3(
      Math.floor(this.x) + 0.5, 
      this.y, 
      Math.floor(this.z) + 0.5
    );
  }

  length(): number {
    return Math.sqrt(
      this.x * this.x + 
      this.y * this.y + 
      this.z * this.z
    );
  }
}

export function calculateYaw(vector: Vector3): number {
  return Math.atan2(vector.z, vector.x) * (180 / Math.PI) - 90;
}

export interface MovementConfig {
  canJump?: boolean;
}

export interface Callbacks {
  onStart?: (direction: string, distance: number, config: MovementConfig) => void;
  onStop?: () => void;
  onComplete?: () => void;
}

export interface Rotation {
  x: number;
  y: number;
}

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export class MovementManager {
  private entity: Entity;
  private queue: Promise<void>;
  private isStopped: boolean;
  private intervalHandles: number[];
  private config: MovementConfig;
  private callbacks: Callbacks;

  constructor(entity: Entity, config: MovementConfig = {}) {
    this.entity = entity;
    this.queue = Promise.resolve();
    this.isStopped = false;
    this.intervalHandles = [];
    this.config = {
      canJump: true,
      ...config
    };
    this.callbacks = {
      onStart: undefined,
      onStop: undefined,
      onComplete: undefined
    };
  }

  on(event: keyof Callbacks, callback: Callbacks[keyof Callbacks]): this {
    if (Object.prototype.hasOwnProperty.call(this.callbacks, event)) {
      this.callbacks[event as string] = callback;
    }
    return this;
  }

  move(direction: string, distance: number, options: MovementConfig = {}): this {
    const config = { ...this.config, ...options };
    this.queue = this.queue.then(() => {
      if (this.isStopped || !this.entity.isValid()) {
        this.clearAllIntervals();
        return;
      }
      if (this.callbacks.onStart) this.callbacks.onStart(direction, distance, config);
      return this.executeMove(direction, distance, config);
    });
    return this;
  }

  start(): Promise<void> {
    return this.queue.then(() => {
      if (this.callbacks.onComplete) this.callbacks.onComplete();
    });
  }

  stop(): Promise<void> {
    this.isStopped = true;
    this.clearAllIntervals();
    if (this.callbacks.onStop) this.callbacks.onStop();
    return this.queue;
  }

  private clearAllIntervals(): void {
    this.intervalHandles.forEach(handle => system.clearRun(handle));
    this.intervalHandles = [];
  }

  private executeMove(direction: string, distance: number, options: MovementConfig): Promise<void> {
    return new Promise((resolve) => {
      const entity = this.entity;
      if (!entity.isValid()) {
        this.clearAllIntervals();
        resolve();
        return;
      }

      const movementComponent = entity.getComponent(EntityComponentTypes.Movement) as EntityMovementComponent;
      const speed = movementComponent.defaultValue ?? 0.1;
      const { canJump } = options;

      const directions: Record<string, Vector3> = {
        north: new Vector3(0, 0, -1),
        south: new Vector3(0, 0, 1),
        west: new Vector3(-1, 0, 0),
        east: new Vector3(1, 0, 0),
        northeast: new Vector3(1, 0, -1).scale(Math.SQRT1_2),
        southeast: new Vector3(1, 0, 1).scale(Math.SQRT1_2),
        southwest: new Vector3(-1, 0, 1).scale(Math.SQRT1_2),
        northwest: new Vector3(-1, 0, -1).scale(Math.SQRT1_2)
      };

      const impulseVector = directions[direction].scale(speed);
      let startPosition = new Vector3(entity.location.x, entity.location.y, entity.location.z).center();
      let distanceTraveled = 0;

      movementComponent.setCurrentValue(0);

      const initialYaw = calculateYaw(impulseVector);
      entity.setRotation({ x: 0, y: initialYaw });

      let climbing = false;
      let wasOnGround = entity.isOnGround;

      const moveEntity = () => {
        if (this.isStopped || !entity.isValid()) {
          this.clearAllIntervals();
          resolve();
          return;
        }

        const blockInFront = entity.dimension.getBlockFromRay(
          entity.location,
          directions[direction],
          {
            includePassableBlocks: false,
            includeLiquidBlocks: false,
            maxDistance: 1
          }
        );

        if (canJump && blockInFront?.block && blockInFront.block.above()?.isAir && entity.isOnGround && !climbing) {
          entity.applyImpulse({ x: 0, y: 0.5, z: 0 });
          climbing = true;
        } else if (climbing && !entity.isOnGround) {
          entity.applyImpulse({ x: impulseVector.x * 0.5, y: 0, z: impulseVector.z * 0.5 });
        } else if (climbing && entity.isOnGround) {
          climbing = false;
        } else if (entity.isOnGround) {
          const currentPosition = new Vector3(entity.location.x, entity.location.y, entity.location.z).center();
          distanceTraveled += currentPosition.subtract(startPosition).length();
          startPosition = currentPosition;

          if (distanceTraveled < distance) {
            entity.applyImpulse({ x: impulseVector.x, y: impulseVector.y, z: impulseVector.z });
          } else {
            this.clearAllIntervals();
            movementComponent.resetToDefaultValue();

            // Align to the center of the block
            const finalPosition = new Vector3(entity.location.x, entity.location.y, entity.location.z).center();
            entity.teleport(finalPosition);

            resolve();
          }
        }

        wasOnGround = entity.isOnGround;
      };

      const intervalHandle = system.runInterval(moveEntity, 5);
      this.intervalHandles.push(intervalHandle);

      const updateRotation = () => {
        if (this.isStopped || !entity.isValid()) {
          this.clearAllIntervals();
          resolve();
          return;
        }

        if (distanceTraveled < distance) {
          const yaw = calculateYaw(impulseVector);
          entity.setRotation({ x: 0, y: yaw });
          entity.runCommand(`title @a actionbar X: ${entity.getRotation().x.toFixed(2)} Y: ${entity.getRotation().y.toFixed(2)}`);
          system.run(updateRotation);
        }
      };

      updateRotation();
    });
  }
}