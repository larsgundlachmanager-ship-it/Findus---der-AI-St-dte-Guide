/**
 * Routing service — pedestrian routing facade (OSRM primary, Google fallback).
 */

export type {
  DirectionsStep,
  RouteDirectionsResult,
  PedestrianTravelMode,
  TransitStationStop,
  GeocodeResult,
} from './googleMapsNav';

export {
  fetchRouteDirectionsResult,
  fetchRouteDirections,
  fetchWalkingDirections,
  directionsToWaypoints,
  transitStopsToNavWaypoints,
  walkingDistanceFromSteps,
  parseTransitStationChain,
  geocodePlaceName,
  geocodePlaceNameOsmFirst,
} from './googleMapsNav';
