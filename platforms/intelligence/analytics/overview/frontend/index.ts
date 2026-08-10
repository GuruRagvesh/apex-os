// Intelligence Analytics — overview frontend surface.
//
// One route-level screen. CategoryChart and TicketTrendChart stay internal:
// this screen is their only consumer repo-wide, and publishing them would pull
// recharts into every consumer of '@apex/intelligence-analytics'.

export { default as AnalyticsScreen } from './screens/AnalyticsScreen';
