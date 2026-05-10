// @vitest-environment jsdom
import { describe, test, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { AnchorLayout } from './AnchorLayout';
import { EditorPanel, type ObjectSummary } from './EditorPanel';
import type { ComponentSchemaSection } from '../entity/propertySchema';

afterEach(() => { cleanup(); });

function renderPanel(objects: ObjectSummary[], selectedId: string | null) {
  return render(
    <AnchorLayout>
      <EditorPanel
        objects={objects}
        selectedId={selectedId}
        isFreeCamera={false}
        manifestStore={null}
        selectedTools={[]}
        onSelect={noop}
        onRollDice={noop}
        onUpdateProp={noop}
        onUpdateEntityField={noop}
        onUpdateComponentProp={noop}
        onToggleFreeCamera={noop}
        onToolAction={noop}
        onMutateElement={noop}
        onRemoveElement={noop}
      />
    </AnchorLayout>,
  );
}

const noop = () => {};

function makeSummary(overrides: Partial<ObjectSummary> = {}): ObjectSummary {
  return {
    id:         'e-1',
    objectType: 'token' as ObjectSummary['objectType'],
    name:       'Tok',
    owner:      null,
    tags:       [],
    props:      {},
    componentStates: {},
    sections:   [],
    parentId:   null,
    surface:    null,
    ...overrides,
  };
}

describe('EditorPanel — Mesh section rendering (issue #2 of property-schema-refactor)', () => {
  test('Token entity with a Mesh section shows three rows: color, meshRef, textureUrl', () => {
    const meshSection: ComponentSchemaSection = {
      typeId: 'mesh',
      label:  'Mesh',
      state:  { color: '#abcdef', meshRef: 'prim:meeple', textureRefs: { default: 'base:tex/x' } },
      entries: [
        { key: 'color',      label: 'Color',   type: 'color' },
        { key: 'meshRef',    label: 'Mesh',    type: 'asset:model' },
        { key: 'textureUrl', label: 'Texture', type: 'asset:image',
          get: (s: any) => s.textureRefs?.default ?? '',
          set: (v, s: any) => ({ textureRefs: { ...s.textureRefs, default: String(v) } }) },
      ],
    };
    const objects: ObjectSummary[] = [makeSummary({ id: 'tok-1', sections: [meshSection] })];

    const { container, getAllByText, getByDisplayValue } = renderPanel(objects, 'tok-1');

    // Mesh header is rendered.
    expect(getAllByText(/^Mesh$/).length).toBeGreaterThan(0);
    // Color row has the current value.
    expect(getByDisplayValue('#abcdef')).toBeDefined();
    // Three labelled rows from the schema.
    expect(container.textContent).toContain('Color');
    expect(container.textContent).toContain('Texture');
  });

  test('Entity section renders above component sections with Name / Owner / Tags', () => {
    const meshSection: ComponentSchemaSection = {
      typeId: 'mesh',
      label:  'Mesh',
      state:  { color: '#fff', meshRef: 'prim:cube', textureRefs: {} },
      entries: [{ key: 'color', label: 'Color', type: 'color' }],
    };
    const objects: ObjectSummary[] = [makeSummary({
      id: 'tok-2', name: 'My Token', sections: [meshSection],
    })];

    const { container } = renderPanel(objects, 'tok-2');

    expect(container.textContent).toContain('Entity');
    expect(container.textContent).toContain('Name');
    expect(container.textContent).toContain('Owner');
    expect(container.textContent).toContain('Tags');
    // Entity section appears before Mesh section.
    const html = container.innerHTML;
    expect(html.indexOf('Entity')).toBeLessThan(html.indexOf('Mesh'));
  });
});
