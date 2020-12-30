/**
 * @constant sleeping 休眠直到指定tick
 * @constant active 活跃的
 * @constant waiting 等待直到check函数返回true
 * @constant suspended 挂起直到唤醒
 */

type ProcessState = 'sp' | 'a' | 'w' | 'sd';

type ProcessTypes = 'filling'
    | 'mineSource'
    | 'boost'
    | 'upgrade'
    | 'baseWork'
    | 'scout'
    | 'tower'
    | 'reserving'
    | 'carry'
    | 'colonize'
    | 'repair'
    | 'defend'
    | 'defendInvader'
    | 'defendInvaderCore'
    | 'dismantle'
    | 'defendNuke'
    | 'mineMineral'
    | 'labReact';

interface protoProcess {
    st: ShortProcessState;
    slt?: number;
    p: string;
    sp: string[];
    bees: { [role: string]: string[] };
}

type protoProcessFilling = protoProcess & {};

type protoProcessMineSource = protoProcess & {
    target: string;
    EO: number;
};

type protoProcessBoost = protoProcess & {
    type: 'single' | 'lasting';
};

type protoProcessReserving = protoProcess & {
    target: string;
};

type protoProcessCarry = protoProcess & {
    target: string;
};

type protoProcessColonize = protoProcess & {
    from: string;
    claimed: boolean;
};

type protoProcessDefendInvader = protoProcess & {
    target: string;
};

type protoProcessDefendInvaderCore = protoProcess & {
    target: string;
};

type protoProcessDismantle = protoProcess & {
    target: string;
};

type protoProcessLabReact = protoProcess & {
    state: 'none' | 'fill' | 'react' | 'take';
    type?: MineralCompoundConstant;
    amount?: number;
};