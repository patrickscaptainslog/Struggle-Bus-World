// World props: trees (one instanced draw per city tile), the two hand-built
// landmarks (Sutro Tower, Transamerica Pyramid) and the rooftop sprouts that
// painted buildings grow. Implementation lives in ./props/*.
export { TreeField, treeHeight, treeScale, type TreeInstance, type TreeLod } from './props/trees';
export { RoofSprouts, type RoofRect } from './props/sprouts';
export { makeSutroTower, makeTransamerica } from './props/landmarks';
export { propsTune } from './props/common';
