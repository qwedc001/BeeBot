import { BarrierPlanner } from 'basePlanner/BarrierPlanner';
import { BeeBot } from 'BeeBot/BeeBot';
import { USER_NAME } from 'config';
import { log } from 'console/log';
import { isStoreStructure } from 'declarations/typeGuards';
import { clock } from 'event/Clock';
import { event } from 'event/Event';
import { timer } from 'event/Timer';
import { profile } from 'profiler/decorator';
import { coordToRoomPosition, isOwner, timeAfterTick } from 'utilities/helpers';
import { printRoomName } from 'utilities/utils';
import { RoomPlanner } from './RoomPlanner';
import { RoomStructures } from './RoomStructures';
import { extConstructOrder, structureLayout } from './structurePreset';

const constructOrder: StructureConstant[] = [
    STRUCTURE_SPAWN,
    STRUCTURE_ROAD,
    STRUCTURE_TOWER,
    STRUCTURE_EXTENSION,
    STRUCTURE_LINK,
    STRUCTURE_CONTAINER,
    STRUCTURE_RAMPART,
    STRUCTURE_STORAGE,
    STRUCTURE_TERMINAL,
    STRUCTURE_LAB,
    STRUCTURE_EXTRACTOR,
    STRUCTURE_OBSERVER,
    STRUCTURE_FACTORY,
    STRUCTURE_POWER_SPAWN,
    STRUCTURE_NUKER,
];

export const ROAD_CONSTRUCT_RCL = 4;
export const CONTAINER_CONSTRUCT_RCL = 4;
export const RAMPART_CONSTRUCT_RCL = 3;

export const SAFE_CONSTRUCT_ENERGY_LINE = 200e3;
export const NEED_SAFE_CONSTRUCT_COST = 50e3;

@profile
export class BaseConstructor {
    private static constructors: { [roomName: string]: BaseConstructor } = {};
    private static roomBuilding: { [roomName: string]: RoomStructures } = {};

    private roomName: string;
    private base: Coord;
    private filteredExtConstructingOrder: RoomPosition[];

    constructor(roomName: string) {
        if (!BeeBot.colonies().find(room => room.name == roomName)) {
            log.error('Should not new BaseConstructor for a non-base room!');
            return;
        }

        this.roomName = roomName;
        let data = RoomPlanner.getRoomData(roomName);
        const terrain = Game.map.getRoomTerrain(roomName);
        if (!data) {
            log.warning(`RoomData of ${printRoomName(this.roomName)} does not exists! planing...`);
            data = RoomPlanner.planRoom(this.roomName, undefined, true).result;
            if (!data) return;
        }

        BaseConstructor.constructors[roomName] = this;

        this.base = data.basePos!;
        this.filteredExtConstructingOrder = extConstructOrder.filter(
            coord => terrain.get(data!.basePos!.x + coord.x, data!.basePos!.y + coord.y) != TERRAIN_MASK_WALL)
            .map(coord => new RoomPosition(data!.basePos!.x + coord.x, data!.basePos!.y + coord.y, roomName));

        event.addEventListener('onBuildComplete',
            (arg: OnBuildCompleteArg) => {
                BaseConstructor.refreshRoomStructures(arg.pos.roomName);
                if (Game.map.getRoomLinearDistance(arg.pos.roomName, roomName) > 2) return;
                this.constructBuildings();
            });

        // 等待RoomData更新
        event.addEventListener('onRclUpgrade',
            () => timer.callBackAtTick(timeAfterTick(1), () => this.constructBuildings()));
        clock.addAction(100, () => this.constructBuildings()); // TODO: 在建筑消失的时候放建筑点
    }

    public static get(roomName: string): BaseConstructor {
        if (this.constructors[roomName]) return this.constructors[roomName];
        return this.constructors[roomName] = new BaseConstructor(roomName);
    }

    public constructBuildings() {
        const room = Game.rooms[this.roomName];
        const controller = room?.controller;
        if (!controller) return;
        if (room.constructionSites.length) return;

        const rcl = controller.level;

        const checkAndConstructMissing = (coords: Coord[] | RoomPosition[],
                                          type: StructureConstant, transform: boolean) => {
            const missing = this.checkMissingBuildings(type, coords, transform);
            if (!missing.length) return false;
            this.createConstructionSites(type, missing, transform);
            return true;
        };

        const data = RoomPlanner.getRoomData(this.roomName);
        if (!data) {
            log.warning(`RoomData of ${printRoomName(this.roomName)} does not exists! replaning...`);
            RoomPlanner.planRoom(this.roomName, undefined, true);
            return;
        }

        const center = new RoomPosition(data.basePos!.x + 5, data.basePos!.y + 5, this.roomName);

        const layout = structureLayout[rcl].buildings;
        for (const type of constructOrder) {
            if (type == STRUCTURE_EXTENSION) {
                const missing = checkAndConstructMissing(
                    this.filteredExtConstructingOrder.slice(0, CONTROLLER_STRUCTURES.extension[rcl]),
                    STRUCTURE_EXTENSION, false);
                if (missing) return;
                continue;
            }

            if (type == STRUCTURE_EXTRACTOR) {
                if (rcl < 6) continue;
                const mineral = room.find(FIND_MINERALS)[0];
                const missing = checkAndConstructMissing([mineral.pos], STRUCTURE_EXTRACTOR, false);
                if (missing) return;
                continue;
            }

            if (type == STRUCTURE_RAMPART) {
                if (rcl < RAMPART_CONSTRUCT_RCL) continue;
                const missing = checkAndConstructMissing(BarrierPlanner.get(this.roomName).getBarriers()
                    , STRUCTURE_RAMPART, false);
                if (missing) return;
                continue;
            }

            if (CONSTRUCTION_COST[type] < NEED_SAFE_CONSTRUCT_COST
                || (room.storage?.store.energy || 0) > SAFE_CONSTRUCT_ENERGY_LINE) {
                const missing = checkAndConstructMissing(layout[type], type, true);
                if (missing) return;
            }

            if (type == STRUCTURE_CONTAINER && rcl >= CONTAINER_CONSTRUCT_RCL) {
                const coords = [
                    ...data.harvestPos.source.filter(coord => !room.links.find(
                        link => link.pos.inRangeToXY(coord.x, coord.y, 1)))];
                if (rcl >= 6) coords.push(data.harvestPos.mineral!);
                const missing = checkAndConstructMissing(coords, STRUCTURE_CONTAINER, false);
                if (missing) return;
            }

            if (type == STRUCTURE_LINK && room.links.length < CONTROLLER_STRUCTURES.link[rcl]) {
                const coords = _.sortBy([...data.linkPos!.source, data.linkPos!.controller],
                    coord => -center.getRangeToXY(coord.x, coord.y))
                    .slice(0, CONTROLLER_STRUCTURES.link[rcl] - layout[STRUCTURE_LINK].length);
                const missing = checkAndConstructMissing(coords, STRUCTURE_LINK, false);
                if (missing) return;
            }

            if (type == STRUCTURE_ROAD && rcl >= ROAD_CONSTRUCT_RCL) {
                const paths = [...data.sourcesPath, data.controllerPath!];
                if (rcl >= 6) paths.push(data.mineralPath!);
                for (const path of paths) {
                    const missing = checkAndConstructMissing(path.path, STRUCTURE_ROAD, false);
                    if (missing) return;
                }
            }
        }

        const outposts = BeeBot.getOutposts(this.roomName);
        outposts.forEach(outpost => {
            const data = RoomPlanner.getRoomData(outpost);
            if (!data) return;

            if (rcl >= ROAD_CONSTRUCT_RCL) {
                for (const path of data.sourcesPath) {
                    checkAndConstructMissing(path.path, STRUCTURE_ROAD, false);
                }
            }

            if (rcl >= CONTAINER_CONSTRUCT_RCL) {
                checkAndConstructMissing(data.harvestPos.source.map(
                    coord => coordToRoomPosition(coord, outpost)), STRUCTURE_CONTAINER, false);
            }
        });
    }

    public constructNukeBarriers() {
        const barriers = BarrierPlanner.get(this.roomName).getNukeBarriers();
        const missing = this.checkMissingBuildings(STRUCTURE_RAMPART, barriers);
        if (missing.length) this.createConstructionSites(STRUCTURE_RAMPART, barriers);
    }

    private checkMissingBuildings(type: StructureConstant, coords: Coord[], transform: boolean): Coord[];
    private checkMissingBuildings(type: StructureConstant, poses: RoomPosition[]): RoomPosition[];

    private checkMissingBuildings(type: StructureConstant, coords: Coord[] | RoomPosition[], transform?: boolean) {
        if (!coords.length) return [];

        function isRoomPositionArray(coords): coords is RoomPosition[] {
            return coords[0] instanceof RoomPosition;
        }

        if (isRoomPositionArray(coords)) {
            return coords.filter(pos => {
                const roomBuilding = BaseConstructor.getRoomStructures(pos.roomName);
                if (!roomBuilding) return false;
                const structure = roomBuilding.getForAt(type, pos) as any;
                return (!structure || (structure.owner && structure.owner.username != USER_NAME));
            });
        }

        const roomBuilding = BaseConstructor.getRoomStructures(this.roomName);
        if (!roomBuilding) return [];

        return coords.filter(coord => {
            const x = coord.x + (transform ? this.base.x : 0);
            const y = coord.y + (transform ? this.base.y : 0);
            const structure = roomBuilding.getForAt(type, x, y) as any;
            return (!structure || (structure.owner && structure.owner.username != USER_NAME));
        });
    }

    private createConstructionSites(type: StructureConstant, coords: Coord[], transform: boolean);
    private createConstructionSites(type: StructureConstant, poses: RoomPosition[]);

    private createConstructionSites(type: StructureConstant, coords: Coord[] | RoomPosition[], transform?: boolean) {
        for (const coord of coords) {
            let roomName = this.roomName;
            if (coord instanceof RoomPosition) roomName = coord.roomName;
            const room = Game.rooms[roomName];
            if (!room) continue;

            const x = coord.x + (transform ? this.base.x : 0);
            const y = coord.y + (transform ? this.base.y : 0);

            const site = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y)[0];
            if (site) {
                if (site.structureType != type || !site.my) site.remove();
                continue;
            }

            const code = room.createConstructionSite(x, y, type as any);
            if (code === OK) continue;
            if (code === ERR_INVALID_TARGET) {
                const structure = room.lookForAt(LOOK_STRUCTURES, x, y)[0];
                if (!structure) continue;
                if (isOwner(structure)) continue;
                if (structure && structure.destroy) structure.destroy();
            }
            if (code === ERR_RCL_NOT_ENOUGH) {
                room.find(FIND_STRUCTURES).filter(structure =>
                    structure.structureType == type
                    && (structure as any).owner
                    && (structure as any).owner.username != USER_NAME).forEach(structure => structure.destroy());
            }
            return false;
        }
        return true;
    }

    public clearRoom(clean: boolean = false) {
        const room = Game.rooms[this.roomName];
        if (!room) return;

        room.structures.forEach(structure => {
            if (isOwner(structure)) return;
            if (clean || structure.structureType != STRUCTURE_STORAGE
                && structure.structureType != STRUCTURE_TERMINAL
                && structure.structureType != STRUCTURE_FACTORY) {
                structure.destroy();
                return;
            }
            if (isStoreStructure(structure) && !structure.store.energy) structure.destroy();
        });
    }

    public getAtBase(x: number, y: number): StructureAtPos;
    public getAtBase(roomPosition: Coord): StructureAtPos;

    public getAtBase(x: number | Coord, y?: number): StructureAtPos | undefined {
        if (typeof x != 'number') {
            y = x.y;
            x = x.x;
        }
        if (y == undefined) return;

        const structures = BaseConstructor.getRoomStructures(this.roomName);
        if (!structures) return;

        return structures.getAt(x + this.base.x, y + this.base.y);
    }

    public getForAtBase<T extends StructureConstant>(type: T, x: number, y: number): TypeToStructure[T] | undefined;
    public getForAtBase<T extends StructureConstant>(type: T, pos: Coord): TypeToStructure[T] | undefined;

    public getForAtBase<T extends StructureConstant>(type: T, x: number | Coord,
                                                     y?: number): TypeToStructure[T] | undefined {
        if (typeof x != 'number') {
            y = x.y;
            x = x.x;
        }
        if (y == undefined) return;

        const structures = BaseConstructor.getRoomStructures(this.roomName);
        if (!structures) return;

        return structures.getAt(x + this.base.x, y + this.base.y)[type] as any;
    }

    public getAt(x: number, y: number): StructureAtPos;
    public getAt(roomPosition: Coord): StructureAtPos;

    public getAt(x: number | Coord, y?: number): StructureAtPos | undefined {
        if (typeof x != 'number') {
            y = x.y;
            x = x.x;
        }
        if (y == undefined) return;
        if (x < 1 || x > 48 || y < 1 || y > 48) return;

        const structures = BaseConstructor.getRoomStructures(this.roomName);
        if (!structures) return;

        return structures.getAt(x, y);
    }

    public getForAt<T extends StructureConstant>(type: T, x: number, y: number): TypeToStructure[T] | undefined;
    public getForAt<T extends StructureConstant>(type: T, pos: Coord): TypeToStructure[T] | undefined;

    public getForAt<T extends StructureConstant>(type: T, x: number | Coord, y?: number): TypeToStructure[T] | undefined {
        if (typeof x != 'number') {
            y = x.y;
            x = x.x;
        }
        if (y == undefined) return;
        if (x < 1 || x > 48 || y < 1 || y > 48) return;

        const structures = BaseConstructor.getRoomStructures(this.roomName);
        if (!structures) return;

        return structures.getAt(x, y)[type] as any;
    }

    public static refreshRoomStructures(roomName: string): RoomStructures | undefined {
        const room = Game.rooms[roomName];
        if (!room) return this.roomBuilding[roomName];
        const structures: RoomStructures = new RoomStructures();
        for (const structure of room.find(FIND_STRUCTURES)) {
            structures.setStructure(structure, structure.pos.x, structure.pos.y);
        }

        return this.roomBuilding[roomName] = structures;
    }

    public static getRoomStructures(roomName: string): RoomStructures | undefined {
        if (this.roomBuilding[roomName]) return this.roomBuilding[roomName];

        const room = Game.rooms[roomName];
        if (!room) return this.roomBuilding[roomName];
        const structures: RoomStructures = new RoomStructures();
        for (const structure of room.find(FIND_STRUCTURES)) {
            structures.setStructure(structure, structure.pos.x, structure.pos.y);
        }

        return this.roomBuilding[roomName] = structures;
    }
}