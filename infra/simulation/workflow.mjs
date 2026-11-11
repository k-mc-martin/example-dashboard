import { feedNames } from './providers.mjs';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function simulationWorkflow(local = false) {
  return {
    id: 'SecDashSimulation',
    name: 'SecDash fictional providers',
    versionId: 'e2e71ed1-909d-44d7-8ad5-77a00f029e08',
    active: false,
    settings: {
      executionOrder: 'v1',
      saveDataErrorExecution: 'none',
      saveDataSuccessExecution: 'none',
      saveManualExecutions: false,
    },
    nodes: [
      {
        id: 'receive',
        name: 'Workspace event',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2.1,
        position: [0, 0],
        webhookId: 'e62c61c6-a40b-494c-bfe9-fd63428adb23',
        parameters: {
          httpMethod: 'POST',
          path: 'secdash-events',
          responseMode: 'lastNode',
          responseData: 'firstEntryJson',
          options: {},
        },
      },
      {
        id: 'select',
        name: 'Select fictional providers',
        type: 'n8n-nodes-base.set',
        typeVersion: 3.4,
        position: [230, 0],
        parameters: {
          assignments: {
            assignments: [
              {
                id: 'feeds',
                name: 'feeds',
                type: 'array',
                value: '={{ ' + JSON.stringify(feedNames) + ' }}',
              },
              { id: 'scenario', name: 'scenario', type: 'object', value: '={{ $json.body }}' },
            ],
          },
          options: {},
        },
      },
      {
        id: 'split',
        name: 'One request per provider',
        type: 'n8n-nodes-base.splitOut',
        typeVersion: 1,
        position: [460, 0],
        parameters: { fieldToSplitOut: 'feeds', include: 'allOtherFields', options: {} },
      },
      {
        id: 'simulate',
        name: 'Collect fictional provider events',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [690, 0],
        parameters: {
          method: 'POST',
          url: '=http://' + (local ? '127.0.0.1' : 'providers') + ':5791/v1/{{ $json.feeds }}',
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={{ $json.scenario }}',
          options: { timeout: 5000, redirect: { redirect: { followRedirects: false } } },
        },
      },
      {
        id: 'batch',
        name: 'Deliver complete event batch',
        type: 'n8n-nodes-base.aggregate',
        typeVersion: 1,
        position: [920, 0],
        parameters: { aggregate: 'aggregateAllItemData', destinationFieldName: 'feeds', options: {} },
      },
    ],
    connections: Object.fromEntries(
      [
        'Workspace event',
        'Select fictional providers',
        'One request per provider',
        'Collect fictional provider events',
      ].map((name, i) => [
        name,
        {
          main: [
            [
              {
                node: [
                  'Select fictional providers',
                  'One request per provider',
                  'Collect fictional provider events',
                  'Deliver complete event batch',
                ][i],
                type: 'main',
                index: 0,
              },
            ],
          ],
        },
      ]),
    ),
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(
    process.argv[2],
    JSON.stringify(simulationWorkflow(process.argv.includes('--local')), null, 2) + '\n',
  );
}
