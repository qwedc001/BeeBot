// Attack task, includes attack and ranged attack if applicable.
// Use meleeAttack and rangedAttack for the exclusive variants.

import {Task} from '../Task';

export type attackTargetType = Creep | Structure;

export class TaskAttack extends Task {

	public static taskName = 'attack';

	constructor(target: attackTargetType, options = {} as TaskOptions) {
		super(TaskAttack.taskName, target, options);
		// Settings
		this.settings.targetRange = 3;
	}

	public get target() {
		return super.target as attackTargetType;
	}

	public isValidTask() {
		return (this.bee.getActiveBodyparts(ATTACK) > 0 || this.bee.getActiveBodyparts(RANGED_ATTACK) > 0);
	}

	public isValidTarget(): boolean {
		return this.target && this.target.hits > 0;
	}

	public work() {
		const creep = this.bee;
		const target = this.target;
		let attackReturn = 0;
		let rangedAttackReturn = 0;
		if (creep.getActiveBodyparts(ATTACK) > 0) {
			if (creep.pos.isNearTo(target)) {
				attackReturn = creep.attack(target);
			} else {
				attackReturn = this.moveToTarget(1); // approach target if you also have attack parts
			}
		}
		if (creep.pos.inRangeTo(target, 3) && creep.getActiveBodyparts(RANGED_ATTACK) > 0) {
			rangedAttackReturn = creep.rangedAttack(target);
		}
		if (attackReturn == OK && rangedAttackReturn == OK) {
			return OK;
		} else {
			if (attackReturn != OK) {
				return rangedAttackReturn;
			} else {
				return attackReturn;
			}
		}
	}
}
