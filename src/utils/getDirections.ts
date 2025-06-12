import axios from 'axios';

export const getDirections = async (origin: string, destination: string, waypoints: string[] = []) => {
  const waypointsParam = waypoints.join('|');
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&waypoints=${waypointsParam}&mode=walking&key=${process.env.GOOGLE_MAPS_API_KEY}`;

  const response = await axios.get(url);
  return response.data.routes[0]?.overview_polyline?.points;
};