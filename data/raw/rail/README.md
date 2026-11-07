# data/raw/rail (A2)

Raw inputs for the rail model. Expected (contract.md §6.2):

- `stations.json`: davwheat/uk-railway-stations as downloaded
- `routes.json`: hero corridors (operator, pattern, first/last departures, duration, calling points)
- `fares.csv`: walk-up fares per route, as collected (pounds as text is fine)
- `performance.csv`: punctuality history (real, or a seed sample labelled as such)
- `snapshot/`: frozen data for the offline demo (M3)
