let map;
let markers = [];
let markerLayer;
let allProviders = [];
let filteredProviders = [];

// Parse CSV data (handles quoted fields properly)
function parseCSV(csv) {
    const lines = csv.trim().split('\n');
    const headers = parseCSVLine(lines[0]);
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const obj = {};
        headers.forEach((header, index) => { obj[header] = values[index] || ''; });
        data.push(obj);
    }
    return data;
}

// Parse a single CSV line handling quotes properly
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        if (char === '"') {
            if (inQuotes && nextChar === '"') { current += '"'; i++; }
            else { inQuotes = !inQuotes; }
        } else if (char === ',' && !inQuotes) {
            result.push(current); current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

// Initialize the Leaflet map (no API callback needed)
function initMap() {
    map = L.map('map').setView([41.7, -71.5], 9);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    markerLayer = L.layerGroup().addTo(map);
    loadProviders();
}

// Load and parse provider data
function loadProviders() {
    document.getElementById('loading').classList.add('active');
    try {
        allProviders = parseCSV(csvData);
        populateFilters();
        filteredProviders = allProviders;
        displayProviders(allProviders);
        addMarkersToMap(allProviders);
        document.getElementById('loading').classList.remove('active');
    } catch (error) {
        console.error('Error loading providers:', error);
        document.getElementById('loading').classList.remove('active');
        alert('Error loading provider data');
    }
}

// Build specialty checkboxes from data
function populateFilters() {
    const specialties = new Set();
    allProviders.forEach(p => specialties.add(p.Specialty));
    const container = document.getElementById('specialtyCheckboxes');
    [...specialties].sort().forEach(specialty => {
        const div = document.createElement('div');
        div.className = 'checkbox-group';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.id = `specialty_${specialty.replace(/\s+/g, '_')}`;
        cb.value = specialty; cb.name = 'specialty';
        const label = document.createElement('label');
        label.htmlFor = cb.id; label.textContent = specialty;
        div.appendChild(cb); div.appendChild(label);
        container.appendChild(div);
    });
}

function getSelectedSpecialties() {
    return Array.from(document.querySelectorAll('input[name="specialty"]:checked')).map(cb => cb.value);
}

// Haversine distance in miles
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3959;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
              Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Free zip geocoding via Nominatim — no API key needed
function geocodeZip(zip, callback) {
    const url = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zip)}&countrycodes=us&format=json&limit=1`;
    fetch(url, { headers: { 'Accept-Language': 'en' } })
        .then(r => r.json())
        .then(data => {
            if (data && data.length > 0) callback(parseFloat(data[0].lat), parseFloat(data[0].lon));
            else { alert('Could not find location for zip code: ' + zip); callback(null, null); }
        })
        .catch(() => { alert('Geocoding failed. Please try again.'); callback(null, null); });
}

// Search form handler
function searchProviders(event) {
    event.preventDefault();
    const nameQuery     = document.getElementById('searchName').value.toLowerCase();
    const selectedSpecs = getSelectedSpecialties();
    const zipQuery      = document.getElementById('searchZip').value.trim();
    const radiusMiles   = parseInt(document.getElementById('radiusSelect').value);
    const genderQuery   = document.querySelector('input[name="gender"]:checked').value;
    const acceptingOnly = document.getElementById('acceptingPatients').checked;

    if (zipQuery) {
        document.getElementById('loading').classList.add('active');
        geocodeZip(zipQuery, (lat, lng) => {
            document.getElementById('loading').classList.remove('active');
            filterProvidersWithRadius(nameQuery, selectedSpecs, genderQuery, acceptingOnly, lat, lng, radiusMiles);
        });
    } else {
        filterProvidersWithRadius(nameQuery, selectedSpecs, genderQuery, acceptingOnly, null, null, radiusMiles);
    }
}

// Filter providers and update map
function filterProvidersWithRadius(nameQuery, selectedSpecs, genderQuery, acceptingOnly, zipLat, zipLng, radiusMiles) {
    filteredProviders = allProviders.filter(p => {
        const matchesName = !nameQuery ||
            p['First Name'].toLowerCase().includes(nameQuery) ||
            p['Last Name'].toLowerCase().includes(nameQuery);
        const matchesSpecialty = selectedSpecs.length === 0 || selectedSpecs.includes(p.Specialty);
        let matchesZip = true;
        if (zipLat !== null && zipLng !== null) {
            const pLat = parseFloat(p['Practice:Latitude']);
            const pLng = parseFloat(p['Practice:Longitude']);
            matchesZip = !isNaN(pLat) && !isNaN(pLng) &&
                calculateDistance(zipLat, zipLng, pLat, pLng) <= radiusMiles;
        }
        const matchesGender    = !genderQuery || p.Gender === genderQuery;
        const matchesAccepting = !acceptingOnly || p['Accepting New Patients'] === 'True';
        return matchesName && matchesSpecialty && matchesZip && matchesGender && matchesAccepting;
    });

    displayProviders(filteredProviders);
    clearMarkers();
    addMarkersToMap(filteredProviders);

    if (zipLat !== null && zipLng !== null) {
        map.setView([zipLat, zipLng], 11);
        if (window.searchCircle) map.removeLayer(window.searchCircle);
        window.searchCircle = L.circle([zipLat, zipLng], {
            radius: radiusMiles * 1609.34,
            color: '#667eea', fillColor: '#667eea',
            fillOpacity: 0.1, weight: 2, opacity: 0.4
        }).addTo(map);
    } else {
        if (window.searchCircle) { map.removeLayer(window.searchCircle); window.searchCircle = null; }
    }
}

// Reset everything
function clearSearch() {
    document.getElementById('searchForm').reset();
    document.querySelectorAll('input[name="specialty"]').forEach(cb => cb.checked = false);
    filteredProviders = allProviders;
    displayProviders(allProviders);
    clearMarkers();
    addMarkersToMap(allProviders);
    if (window.searchCircle) { map.removeLayer(window.searchCircle); window.searchCircle = null; }
    map.setView([41.7, -71.5], 9);
}

// Render provider result cards
function displayProviders(providers) {
    const resultsDiv   = document.getElementById('providerResults');
    const resultsCount = document.getElementById('resultsCount');
    resultsCount.textContent = `${providers.length} provider${providers.length !== 1 ? 's' : ''}`;

    providers = [...providers].sort((a, b) => {
        const aA = a['Accepting New Patients'] === 'True';
        const bA = b['Accepting New Patients'] === 'True';
        if (aA !== bA) return aA ? -1 : 1;
        const lc = a['Last Name'].localeCompare(b['Last Name']);
        return lc !== 0 ? lc : a['First Name'].localeCompare(b['First Name']);
    });

    if (providers.length === 0) {
        resultsDiv.innerHTML = '<div class="no-results">No providers found matching your criteria</div>';
        return;
    }

    resultsDiv.innerHTML = providers.map(p => `
        <div class="provider-card">
            <div class="provider-name">
                ${p['First Name']} ${p['Last Name']}, ${p.Degree}
                <br /><span class="provider-specialty">${p.Specialty}</span>
            </div>
            <div class="provider-info">
                <strong>${p.Practice}</strong><br>
                ${p['Practice:Address']}${p['Practice:Address 2'] ? ', ' + p['Practice:Address 2'] : ''}<br>
                ${p['Practice:City']}, RI ${p['Practice:Zip']}
            </div>
            <div class="provider-buttons">
                <button type="button" class="btn btn-secondary call-btn" onclick="callProvider('${p['Practice:Main Line']}')">
                    <span class="providers-list-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16"><path d="M11 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zM5 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z"/><path d="M8 14a1 1 0 1 0 0-2 1 1 0 0 0 0 2"/></svg></span>
                    ${p['Practice:Main Line']}
                </button>
                <button type="button" class="btn btn-secondary schedule-btn" onclick="scheduleAppointment()">
                    <span class="providers-list-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16"><path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M2 2a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z"/><path d="M2.5 4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5zM11 7.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5zm-3 0a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5zm-5 3a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5zm3 0a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5z"/></svg></span>
                    Schedule appointment
                </button>
            </div>
            <span class="badge ${p['Accepting New Patients'] === 'True' ? 'badge-accepting' : 'badge-not-accepting'}">
                ${p['Accepting New Patients'] === 'True' ? '✓ Accepting New Patients' : '✗ Not accepting new patients'}
            </span>
        </div>
    `).join('');
}

// Custom SVG circle icon (green = accepting, red = not)
function makeIcon(accepting) {
    const color = accepting ? '#4CAF50' : '#FF5722';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="8" fill="${color}" fill-opacity="0.9" stroke="#fff" stroke-width="2"/>
    </svg>`;
    return L.divIcon({ html: svg, className: '', iconSize: [20,20], iconAnchor: [10,10], popupAnchor: [0,-10] });
}

// Place markers on the Leaflet map
function addMarkersToMap(providers) {
    let acceptingCount = 0;
    providers.forEach(p => {
        const lat = parseFloat(p['Practice:Latitude']);
        const lng = parseFloat(p['Practice:Longitude']);
        if (isNaN(lat) || isNaN(lng)) return;

        const accepting = p['Accepting New Patients'] === 'True';
        if (accepting) acceptingCount++;

        const marker = L.marker([lat, lng], {
            icon: makeIcon(accepting),
            title: `${p['First Name']} ${p['Last Name']}`
        });

        marker.bindPopup(`
            <div style="padding:6px;max-width:280px;">
                <h3 style="margin:0 0 6px;color:#000;font-size:15px;">${p['First Name']} ${p['Last Name']}, ${p.Degree}</h3>
                <p style="margin:4px 0;font-weight:600;color:#667eea;">${p.Specialty}</p>
                <p style="margin:6px 0;font-weight:bold;">${p.Practice}</p>
                <p style="margin:4px 0;line-height:1.5;">
                    ${p['Practice:Address']}${p['Practice:Address 2'] ? ', ' + p['Practice:Address 2'] : ''}<br>
                    ${p['Practice:City']}, RI ${p['Practice:Zip']}
                </p>
                <p style="margin:6px 0;">
                    <a href="tel:${p['Practice:Main Line'].replace(/[^0-9+]/g,'')}" style="text-decoration:none;">
                        📞 ${p['Practice:Main Line']}
                    </a>
                </p>
                <span style="display:inline-block;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:600;
                    background:${accepting ? '#d4edda' : '#f8d7da'};color:${accepting ? '#155724' : '#721c24'};">
                    ${accepting ? '✓ Accepting New Patients' : '✗ Not Accepting New Patients'}
                </span>
            </div>
        `);

        marker.providerId = p.ID;
        marker.addTo(markerLayer);
        markers.push(marker);
    });

    document.getElementById('markerCount').textContent = markers.length;
    document.getElementById('acceptingCount').textContent = acceptingCount;

    if (markers.length > 0) {
        map.fitBounds(L.featureGroup(markers).getBounds().pad(0.1));
    }
}

// Remove all markers
function clearMarkers() {
    markerLayer.clearLayers();
    markers = [];
    document.getElementById('markerCount').textContent = '0';
    document.getElementById('acceptingCount').textContent = '0';
}

// Pan to provider and open popup
function focusProvider(providerId) {
    const marker = markers.find(m => m.providerId === providerId);
    if (marker) { map.setView(marker.getLatLng(), 15); marker.openPopup(); }
}

// Show loading initially, then init map when DOM is ready
document.getElementById('loading').classList.add('active');
document.addEventListener('DOMContentLoaded', initMap);
