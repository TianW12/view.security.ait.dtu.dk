import React, { useRef, useState, useEffect, useMemo } from 'react';
import Map, { Marker, Layer, Source, Popup } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

interface InteractiveWorldMapProps {
  loginLocations: Array<{
    id: string;
    location: string;
    city: string;
    country: string;
    isFamiliar: boolean;
    timestamp: Date;
    latitude?: number;
    longitude?: number;
  }>;
  diagnosedSignIns: Array<{
    id: string;
    location: string;
    riskLevel: string;
    timestamp: Date;
    latitude?: number;
    longitude?: number;
  }>;
  formatDate: (date: Date) => string;
}

export const InteractiveWorldMap: React.FC<InteractiveWorldMapProps> = ({
  loginLocations,
  diagnosedSignIns,
  formatDate
}) => {
  const mapRef = useRef<any>(null);
  const [viewState, setViewState] = useState({
    longitude: 12.5054, // DTU Lundtoftegårdsvej longitude
    latitude: 55.7859,  // DTU Lundtoftegårdsvej latitude
    zoom: 2,
    pitch: 0,
    bearing: 0
  });
  const [hoveredLocation, setHoveredLocation] = useState<any>(null);

  // Animation states for cyber effects
  const [pulseT, setPulseT] = useState(0);

  // Helper function: great-circle arc between [lon1,lat1] → [lon2,lat2]
  const makeArc = (a: [number, number], b: [number, number], n = 80) => {
    // Simple spherical interpolation (good enough for visuals)
    const toRad = (d: number) => d * Math.PI / 180;
    const toDeg = (r: number) => r * 180 / Math.PI;
    const [lon1, lat1, lon2, lat2] = [toRad(a[0]), toRad(a[1]), toRad(b[0]), toRad(b[1])];
    const d = 2 * Math.asin(Math.sqrt(Math.sin((lat2 - lat1) / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2));
    if (d === 0) return [a, b];
    const coords: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const A = Math.sin((1 - f) * d) / Math.sin(d);
      const B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
      const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
      const z = A * Math.sin(lat1) + B * Math.sin(lat2);
      const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
      const lon = Math.atan2(y, x);
      coords.push([toDeg(lon), toDeg(lat)]);
    }
    return coords;
  };

  // Geographic coordinates for major cities
  const getCoordinates = (city: string, country: string): [number, number] => {
    const coordinates: { [key: string]: [number, number] } = {
      'New York': [-74.0059, 40.7128],
      'Beijing': [116.4074, 39.9042],
      'Tokyo': [139.6917, 35.6895],
      'São Paulo': [-46.6333, -23.5505],
      'Mumbai': [72.8777, 19.0760],
      'Moscow': [37.6173, 55.7558],
      'Sydney': [151.2093, -33.8688],
      'Lagos': [3.3792, 6.5244],
      'London': [-0.1278, 51.5074],
      'Paris': [2.3522, 48.8566],
    };
    
    return coordinates[city] || coordinates[country] || [0, 0];
  };

  // Combine all locations with coordinates
  const allLocations = [
    ...loginLocations.map(l => ({
      ...l,
      coordinates: l.longitude && l.latitude ? 
        [l.longitude, l.latitude] as [number, number] : 
        getCoordinates(l.city, l.country),
      type: 'login' as const,
      riskLevel: l.isFamiliar ? 'safe' : 'medium'
    })),
    ...diagnosedSignIns.map(s => ({
      id: s.id + '_threat',
      location: s.location,
      city: s.location.split(', ')[0],
      country: s.location.split(', ')[1] || s.location,
      coordinates: s.longitude && s.latitude ?
        [s.longitude, s.latitude] as [number, number] :
        getCoordinates(s.location.split(', ')[0], s.location.split(', ')[1] || s.location),
      type: 'threat' as const,
      riskLevel: s.riskLevel.toLowerCase(),
      timestamp: s.timestamp,
      isFamiliar: false
    }))
  ];

  // Create connection lines from DTU to each location
  const dtuCoordinates: [number, number] = [12.5054, 55.7859]; // DTU Lundtoftegårdsvej 93A, Kongens Lyngby

  // Memoize the base raster style so the map style object is stable between renders
  const baseStyle = useMemo(() => ({
    version: 8,
    sources: {
      // dark base with NO labels
      cartoDarkBase: {
        type: 'raster',
        tiles: ['https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap, © CARTO'
      },
      // labels-only overlay (bright) - includes borders
      cartoDarkLabels: {
        type: 'raster',
        tiles: ['https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap, © CARTO'
      }
    },
    layers: [
      { id: 'carto-dark-base', type: 'raster', source: 'cartoDarkBase' },
      // Increase opacity to make borders and labels more visible
      { id: 'carto-dark-labels', type: 'raster', source: 'cartoDarkLabels', paint: { 'raster-opacity': 1.0 } }
    ]
  }), []);



  // Fit map to show all locations + DTU so you don't miss them at low zoom
  useEffect(() => {
    if (!allLocations || !allLocations.length || !mapRef.current) return;
    try {
      // compute bounding box
      const lons = allLocations.map(l => l.coordinates[0]).concat(dtuCoordinates[0]);
      const lats = allLocations.map(l => l.coordinates[1]).concat(dtuCoordinates[1]);
      const minLon = Math.min(...lons);
      const maxLon = Math.max(...lons);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const bounds: [number, number][] = [[minLon, minLat], [maxLon, maxLat]];
      const mapObj = (mapRef.current as any).getMap ? (mapRef.current as any).getMap() : (mapRef.current as any);
      if (mapObj && mapObj.fitBounds) {
        mapObj.fitBounds(bounds, { padding: 60, maxZoom: 3.5, duration: 800 });
      }
    } catch (err) {
      console.warn('fitBounds failed', err);
    }
  }, [JSON.stringify(allLocations)]);
  
  // Create arcs FeatureCollection (use DTU hub as source)
  const arcs = {
    type: 'FeatureCollection' as const,
    features: allLocations.map(l => ({
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: makeArc(dtuCoordinates, l.coordinates, 80)
      },
      properties: { type: l.type }
    }))
  };

  // Hub data for DTU
  const hub = {
    type: 'FeatureCollection' as const,
    features: [{ 
      type: 'Feature' as const, 
      geometry: { type: 'Point' as const, coordinates: dtuCoordinates },
      properties: {}
    }]
  };



  // Pulsing animation for DTU hub
  useEffect(() => {
    let raf = 0;
    const loop = () => { 
      setPulseT(prev => (prev + 0.02) % 1); 
      raf = requestAnimationFrame(loop); 
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Calculate animated pulse radius
  const pulseRadius = 10 + Math.sin(pulseT * Math.PI * 2) * 4;

  // Calculate statistics
  const trustedLocations = loginLocations.filter(l => l.isFamiliar).length;
  const totalLoginLocations = loginLocations.length;
  const securityThreats = diagnosedSignIns.length;

  return (
    <div style={{ width: '100%', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        marginBottom: '20px',
        fontSize: '24px',
        fontWeight: 'bold',
        color: '#1f2937',
        alignContent: 'center'
      }}>
        🗺️ Global Login Activity Map
      </div>

      {/* Statistics Boxes */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '1fr 1fr 1fr', 
        gap: '16px', 
        marginBottom: '24px' 
      }}>
        <div style={{
          background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
          border: '1px solid #0ea5e9',
          borderRadius: '12px',
          padding: '12px',
          textAlign: 'center',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#0369a1', marginBottom: '2px' }}>
            🌐 {totalLoginLocations}
          </div>
          <div style={{ fontSize: '13px', color: '#0369a1', fontWeight: '500' }}>
            Login Locations
          </div>
        </div>

        <div style={{
          background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',
          border: '1px solid #f87171',
          borderRadius: '12px',
          padding: '12px',
          textAlign: 'center',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#dc2626', marginBottom: '2px' }}>
            ⚠️ {securityThreats}
          </div>
          <div style={{ fontSize: '13px', color: '#dc2626', fontWeight: '500' }}>
            Security Threats
          </div>
        </div>

        <div style={{
          background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
          border: '1px solid #4ade80',
          borderRadius: '12px',
          padding: '12px',
          textAlign: 'center',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#16a34a', marginBottom: '2px' }}>
            🟢 {trustedLocations}
          </div>
          <div style={{ fontSize: '13px', color: '#16a34a', fontWeight: '500' }}>
            Trusted Locations
          </div>
        </div>
      </div>

      {/* Map Container */}
      <div className="cyber-map-container" style={{ width: '100%', height: '500px', borderRadius: '12px', overflow: 'hidden', marginBottom: '16px' }}>
      <Map
        ref={mapRef}
        {...viewState}
        onMove={evt => setViewState(evt.viewState)}
        style={{ width: '100%', height: '100%' }}
        renderWorldCopies={false}
        interactiveLayerIds={['hub-core']}
  mapStyle={baseStyle as any}
        attributionControl={false}
      >
        {/* Glowing Arcs */}
        <Source id="arcs" type="geojson" data={arcs}>
          {/* Outer glow */}
          <Layer
            id="arc-glow-outer"
            type="line"
            paint={{
              'line-color': [
                'case',
                ['==', ['get', 'type'], 'threat'], '#ff8fab', '#64d2d1'
              ],
              'line-width': 8,
              'line-opacity': 0.2,
              'line-blur': 5
            }}
          />
          {/* Inner glow */}
          <Layer
            id="arc-glow-inner"
            type="line"
            paint={{
              'line-color': [
                'case',
                ['==', ['get', 'type'], 'threat'], '#ff8fab', '#64d2d1'
              ],
              'line-width': 4,
              'line-opacity': 0.4,
              'line-blur': 2
            }}
          />
          {/* Core line */}
          <Layer
            id="arc-core"
            type="line"
            paint={{
              'line-color': [
                'case',
                ['==', ['get', 'type'], 'threat'], '#ef4444', '#06b6d4'
              ],
              'line-width': 1.5,
              'line-opacity': 1
            }}
          />
        </Source>

        {/* Pulsing DTU Hub */}
        <Source id="hub" type="geojson" data={hub}>
          {/* Outer breathing glow */}
          <Layer
            id="hub-glow-outer"
            type="circle"
            paint={{
              'circle-radius': pulseRadius * 3,
              'circle-color': '#5b7cfa',
              'circle-opacity': 0.1,
              'circle-blur': 2
            }}
          />
          {/* Inner glow ring */}
          <Layer
            id="hub-glow"
            type="circle"
            paint={{
              'circle-radius': pulseRadius * 1.8,
              'circle-color': '#6496ff',
              'circle-opacity': 0.25,
              'circle-blur': 1.5
            }}
          />
          {/* Core */}
          <Layer
            id="hub-core"
            type="circle"
            paint={{
              'circle-radius': 10,
              'circle-color': '#5b7cfa',
              'circle-stroke-color': '#fff',
              'circle-stroke-width': 2
            }}
          />
        </Source>

        {/* Add breathing effect markers on top */}
        {allLocations.map((location) => (
          <Marker
            key={`marker-${location.id}`}
            longitude={location.coordinates[0]}
            latitude={location.coordinates[1]}
            anchor="center"
          >
            <div
              className={location.type === 'threat' ? 'threat-marker breathing' : 'safe-marker breathing'}
              style={{
                width: '28px',        // 🔧 Controls the overall marker container size (was 35px)
                height: '28px',       // 🔧 Controls the overall marker container size (was 35px)
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: location.type === 'threat' ? '13px' : '14px',  // 🔧 Controls icon size: threat=13px, safe=14px (was 16px/18px)
                pointerEvents: 'auto',
                cursor: 'pointer',
                position: 'relative'
              }}
              onMouseEnter={() => setHoveredLocation(location)}
              onMouseLeave={() => setHoveredLocation(null)}
            >
              {location.type === 'threat' ? (
                <>
                  {/* Red circle around threat marker */}
                  <div
                    style={{
                      position: 'absolute',
                      width: '24px',         // 🔧 Controls the red circle size (was 30px)
                      height: '24px',        // 🔧 Controls the red circle size (was 30px)
                      borderRadius: '50%',
                      border: '2px solid rgba(239, 68, 68, 0.6)',
                      background: 'rgba(239, 68, 68, 0.1)',
                      boxShadow: '0 0 15px rgba(239, 68, 68, 0.5)'
                    }}
                  />
                  <span style={{ zIndex: 1 }}>⚠️</span>
                </>
              ) : (
                <>
                  {/* Green circle around safe location marker */}
                  <div
                    style={{
                      position: 'absolute',
                      width: '24px',         // 🔧 Controls the green circle size (was 32px)
                      height: '24px',        // 🔧 Controls the green circle size (was 32px)
                      borderRadius: '50%',
                      border: '2px solid rgba(16, 185, 129, 0.7)',
                      background: 'rgba(16, 185, 129, 0.15)',
                      boxShadow: '0 0 15px rgba(16, 185, 129, 0.6)'
                    }}
                  />
                  <span style={{ 
                    zIndex: 1, 
                    position: 'relative',
                    color: '#10b981',
                    fontWeight: 'bold',
                    fontSize: '16px'
                  }}>✓</span>
                </>
              )}
            </div>
          </Marker>
        ))}

        {/* DTU Hub Marker with icon */}
        <Marker longitude={dtuCoordinates[0]} latitude={dtuCoordinates[1]} anchor="center">
          <div
            className="dtu-hub breathing"
            style={{
              width: '50px',
              height: '50px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              pointerEvents: 'none'
            }}
          >
            {/* Transparent circle background */}
            <div
              style={{
                position: 'absolute',
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: 'rgba(91, 124, 250, 0.15)',
                border: '2px solid rgba(91, 124, 250, 0.5)',
                boxShadow: '0 0 20px rgba(91, 124, 250, 0.4), inset 0 0 15px rgba(91, 124, 250, 0.2)'
              }}
            />
            {/* Building icon on top */}
            <span style={{ fontSize: '24px', zIndex: 1 }}>🏢</span>
          </div>
        </Marker>

        {/* Country Labels */}
        {viewState.zoom <= 4 && [
          { name: 'USA', coord: [-95, 40] },
          { name: 'CHINA', coord: [105, 35] },
          { name: 'RUSSIA', coord: [37, 60] },
          { name: 'INDIA', coord: [77, 20] },
          { name: 'BRAZIL', coord: [-55, -10] },
          { name: 'AUSTRALIA', coord: [151, -27] },
          { name: 'CANADA', coord: [-106, 56] },
          { name: 'GERMANY', coord: [10, 51] }
        ].map((country, index) => (
          <Marker
            key={`country-${index}`}
            longitude={country.coord[0]}
            latitude={country.coord[1]}
            anchor="center"
          >
            <div style={{
              color: '#64d2d1',
              fontWeight: '600',
              fontSize: '12px',
              textShadow: '2px 2px 4px rgba(0, 0, 0, 0.8), 0 0 8px rgba(100, 210, 209, 0.6)',
              letterSpacing: '0.1em',
              pointerEvents: 'none',
              userSelect: 'none'
            }}>
              {country.name}
            </div>
          </Marker>
        ))}

        {/* Hover Popup */}
        {hoveredLocation && (
          <Popup
            longitude={hoveredLocation.coordinates[0]}
            latitude={hoveredLocation.coordinates[1]}
            closeButton={false}
            closeOnClick={false}
            anchor="top"
            offset={[0, 15]}
            className="custom-popup"
            maxWidth="300px"
          >
            <div style={{
              background: 'rgba(15, 23, 42, 0.95)',
              backdropFilter: 'blur(10px)',
              padding: '12px',
              borderRadius: '8px',
              border: hoveredLocation.type === 'threat' 
                ? '2px solid #ef4444'
                : '2px solid #06b6d4',
              boxShadow: hoveredLocation.type === 'threat'
                ? '0 4px 12px rgba(239, 68, 68, 0.5), 0 0 20px rgba(239, 68, 68, 0.3)'
                : '0 4px 12px rgba(6, 182, 212, 0.5), 0 0 20px rgba(6, 182, 212, 0.3)',
              minWidth: '200px',
              fontSize: '14px',
              color: '#f1f5f9'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#f1f5f9' }}>
                📍 {hoveredLocation.city}, {hoveredLocation.country}
              </div>
              <div style={{ marginBottom: '4px', color: '#cbd5e1' }}>
                <strong>Type:</strong> {hoveredLocation.type === 'threat' ? '⚠️ Security Threat' : '✓ Login Location'}
              </div>
              <div style={{ marginBottom: '4px', color: '#cbd5e1' }}>
                <strong>Status:</strong> {hoveredLocation.isFamiliar ? '🟢 Familiar' : '⚠️ Unfamiliar'}
              </div>
              <div style={{ color: '#94a3b8', fontSize: '12px' }}>
                <strong>Time:</strong> {formatDate(hoveredLocation.timestamp)}
              </div>
            </div>
          </Popup>
        )}
      </Map>
      </div>

      {/* Color Indicators */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        gap: '24px', 
        marginTop: '16px',
        fontSize: '14px',
        color: '#64748b'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: 'rgba(16, 185, 129, 0.15)',
            border: '2px solid rgba(16, 185, 129, 0.7)',
            boxShadow: '0 0 8px rgba(16, 185, 129, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px'
          }}>✓</div>
          <span>Login Locations</span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '2px solid rgba(239, 68, 68, 0.6)',
            boxShadow: '0 0 8px rgba(239, 68, 68, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px'
          }}>⚠️</div>
          <span>Security Threats</span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            background: 'rgba(91, 124, 250, 0.15)',
            border: '2px solid rgba(91, 124, 250, 0.5)',
            boxShadow: '0 0 8px rgba(91, 124, 250, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px',
            color: 'white'
          }}>🏢</div>
          <span>DTU AIT-SOC Hub</span>
        </div>
      </div>

      <style>{`
        .custom-popup .maplibregl-popup-content {
          padding: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
        }
        
        /* Cyber glow effects for the map container */
        .cyber-map-container {
          box-shadow: 0 0 50px rgba(6, 182, 212, 0.3), inset 0 0 50px rgba(15, 23, 42, 0.5);
        }

        /* Breathing animation for markers */
        @keyframes breathing {
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.2);
            opacity: 0.8;
          }
        }

        @keyframes threatPulse {
          0%, 100% {
            transform: scale(1);
            filter: drop-shadow(0 0 8px rgba(239, 68, 68, 0.8));
          }
          50% {
            transform: scale(1.3);
            filter: drop-shadow(0 0 15px rgba(239, 68, 68, 1));
          }
        }

        @keyframes safeGlow {
          0%, 100% {
            filter: drop-shadow(0 0 6px rgba(6, 182, 212, 0.6));
          }
          50% {
            filter: drop-shadow(0 0 12px rgba(6, 182, 212, 1));
          }
        }

        @keyframes dtuPulse {
          0%, 100% {
            transform: scale(1);
            filter: drop-shadow(0 0 10px rgba(91, 124, 250, 0.8));
          }
          50% {
            transform: scale(1.15);
            filter: drop-shadow(0 0 20px rgba(91, 124, 250, 1));
          }
        }

        .breathing {
          animation: breathing 2.5s ease-in-out infinite;
        }

        .threat-marker {
          animation: threatPulse 2s ease-in-out infinite;
        }

        .safe-marker {
          animation: safeGlow 3s ease-in-out infinite;
        }

        .dtu-hub {
          animation: dtuPulse 2.5s ease-in-out infinite;
        }
      `}</style>


    </div>
  );
};