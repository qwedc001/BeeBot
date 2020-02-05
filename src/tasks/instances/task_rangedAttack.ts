import {Task} from '../Task';

export type rangedAttackTargetType = Creep | Structure;

export class TaskRangedAttack extends Task {

	public static taskName = 'rangedAttack';
	public target: rangedAttackTargetType;

	constructor(target: rangedAttackTargetType, options = {} as TaskOptions) {
		super(TaskRangedAttack.taskName, target, options);
		// Settings
		this.settings.targetRange = 3;
	}

	public isValidTask() {
		return this.bee.getActiveBodyparts(RANGED_ATTACK) > 0;
	}

	public isValidTarget() {
		return this.target && this.target.hits > 0;
	}

	public work() {
		return this.bee.rangedAttack(this.target);
	}
}

