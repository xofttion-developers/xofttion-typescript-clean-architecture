import { Optional, promisesZip } from '@xofttion/utils';
import { EntityDataSource } from './datasource';
import { Entity } from './entity';
import { BaseModel, ModelHidden } from './model';
import { EntityLink, EntitySync, ModelDirty } from './unit-of-work';

type SyncPromise = {
  model: BaseModel;
  dirty: ModelDirty;
};

export class EntityManager {
  private relations: Map<string, BaseModel>;

  private links: EntityLink[] = [];

  private syncs: EntitySync[] = [];

  private destroys: BaseModel[] = [];

  private hiddens: ModelHidden[] = [];

  constructor(private dataSource: EntityDataSource) {
    this.relations = new Map<string, BaseModel>();
  }

  public persist(link: EntityLink): void {
    this.links.push(link);
  }

  public sync(sync: EntitySync): void {
    this.syncs.push(sync);

    this.relation(sync.entity, sync.model);
  }

  public destroy(entity: Entity): void {
    this.select(entity).present((model) => {
      isHidden(model) ? this.hiddens.push(model) : this.destroys.push(model);
    });
  }

  public relation(entity: Entity, model: BaseModel): void {
    this.relations.set(entity.uuid, model);
  }

  public select(entity: Entity): Optional<BaseModel> {
    return Optional.build(this.relations.get(entity.uuid));
  }

  public flush(): Promise<unknown[]> {
    return promisesZip([
      () => this.persistAll(),
      () => this.syncAll(),
      () => this.hiddenAll(),
      () => this.destroyAll()
    ]).finally(() => {
      this.dispose();
    });
  }

  public async flushAsync(): Promise<void> {
    await this.persistAll();
    await this.syncAll();
    await this.hiddenAll();
    await this.destroyAll();

    this.dispose();
  }

  public dispose(): void {
    this.relations.clear();

    this.links = [];
    this.syncs = [];
    this.destroys = [];
    this.hiddens = [];
  }

  private persistAll(): Promise<void[]> {
    return Promise.all(
      this.links.map((link) => {
        const model = link.createModel(this);

        this.relation(link.entity, model);

        return this.dataSource.insert(model);
      })
    );
  }

  private syncAll(): Promise<void[]> {
    return Promise.all(
      this.syncs
        .filter((sync) => !this.destroys.includes(sync.model))
        .reduce((syncs, sync) => {
          const dirty = sync.verify();

          if (dirty) {
            syncs.push({ model: sync.model, dirty });
          }

          return syncs;
        }, [] as SyncPromise[])
        .map(({ model, dirty }) => this.dataSource.update(model, dirty))
    );
  }

  private destroyAll(): Promise<void[]> {
    return Promise.all(
      this.destroys.map((destroy) => this.dataSource.delete(destroy))
    );
  }

  private hiddenAll(): Promise<void[]> {
    return Promise.all(this.hiddens.map((hidden) => this.dataSource.hidden(hidden)));
  }
}

function isHidden(model: any): model is ModelHidden {
  return 'hidden' in model && 'hiddenAt' in model;
}
