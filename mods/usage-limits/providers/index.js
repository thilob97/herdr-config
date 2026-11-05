import omp from "./omp.js";

// Order here is the order in the status bar and the settings popup.
// Every provider reads omp's own records of /usage (providers/omp.js).
export const PROVIDERS = [...omp];
