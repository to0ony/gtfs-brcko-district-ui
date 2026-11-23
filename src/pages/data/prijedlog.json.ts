// Ne /data/vikend.json: u dev načinu Vite bi na toj adresi poslužio izvornu datoteku iz mape data/.
import plan from '../../../data/vikend.json';
import { analysis } from '../../analiza/data';
import { weekend, type Plan } from '../../analiza/vikend';
import calendar from '../../generated/calendar.json';
import { labels, network } from '../../lib/network';

export const GET = () => Response.json(weekend(network, labels, analysis.settlements, calendar, plan as Plan));
