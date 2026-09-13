import json, time, urllib.parse, urllib.request

PLACES = [
    ("USeP Obrero", "University of Southeastern Philippines Obrero Davao City"),
    ("Victoria Plaza", "Victoria Plaza Mall J.P. Laurel Avenue Davao City"),
    ("Abreeza Mall", "Abreeza Mall J.P. Laurel Avenue Davao City"),
    ("Bajada Flyover", "Bajada Flyover Davao City"),
    ("Bajada", "Bajada J.P. Laurel Avenue Davao City"),
    ("SM Lanang Premier", "SM Lanang Premier Davao City"),
    ("Roxas Night Market", "Roxas Night Market Davao City"),
    ("People's Park", "Peoples Park Davao City"),
    ("Davao City Hall", "Davao City Hall San Pedro Street"),
    ("Gaisano Mall of Davao", "Gaisano Mall of Davao J.P. Laurel Avenue"),
    ("Matina Town Square", "Matina Town Square Davao City"),
    ("SM City Davao", "SM City Davao Ecoland"),
    ("Acacia Hotel", "Acacia Hotel Davao City"),
    ("Davao Doctors Hospital", "Davao Doctors Hospital E. Quirino Avenue"),
    ("Sasa Wharf", "Sasa Wharf Davao City"),
    ("Buhangin", "Buhangin Davao City"),
    ("Toril", "Toril Davao City"),
    ("Calinan", "Calinan Davao City"),
    ("Mintal", "Mintal Davao City"),
    ("Lanang", "Lanang Davao City"),
]
out = {}
for name, q in PLACES:
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "json", "limit": 1, "countrycodes": "ph"})
    req = urllib.request.Request(url, headers={"User-Agent": "DaBound-MVP/0.1 (demo seed builder)"})
    try:
        data = json.load(urllib.request.urlopen(req, timeout=20))
        if data:
            out[name] = {"lat": round(float(data[0]["lat"]), 6), "lng": round(float(data[0]["lon"]), 6),
                         "label": data[0].get("display_name", "")[:90]}
            print("OK ", name, out[name]["lat"], out[name]["lng"])
        else:
            print("MISS", name)
    except Exception as e:
        print("ERR ", name, e)
    time.sleep(1.1)
json.dump(out, open("/home/user/obreroute/data/places.json", "w"), indent=1)
json.dump(out, open("/tmp/places.json", "w"), indent=1)
