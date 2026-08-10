/**
 * Modul-2 Entry — nur Concierge-Manager (neue Vision).
 * Legacy Override-Stack ist tot; keine parallele Bridge/Floskel.
 */

export { runConciergeTurn as runModule2Pipeline } from '../router/runConciergeTurn';
/** @deprecated Alias — gleicher Manager-Pfad */
export { runConciergeTurn as runRebootPipeline } from '../router/runConciergeTurn';
