/**
 * Pattern programs (PRD Part 3, F29): a TypeScript port of GarmentCode / pygarment (MIT, Maria Korosteleva),
 * checked against the original by build-time oracle tests, plus this project's own programs.
 */
export * from './spec';
export * from './build';
export { defaultDesign, randomizeDesign, assertParamCombinations, designLeaves, getLeaf, withValues, type DesignLeaf } from './design';
export { bodyParameters, type Body, type Design } from './programs/base';
export { MetaGarment } from './programs/meta';
export { GARMENTCODE_PROGRAMS, patternPrograms, patternProgram, programDefaultDesign, buildProgram, randomProgramDesign, registerProgram, type PatternProgram } from './programs/registry';
export { patternSvg, layoutPattern, panelOutline, type SvgOptions, type PanelPlacement } from './svg';
export { PS2CC_PROGRAMS, PS2CC_GROUPS } from './programs/ps2cc-programs';
export { makePs2Pattern, serializePs2Pattern, parsePs2Pattern, rebuildPs2Pattern, PATTERN_GENERATOR_VERSION, type Ps2Pattern } from './ps2pattern';
