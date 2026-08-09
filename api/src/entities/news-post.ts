import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * Notícia exibida no launcher. Vive no banco (e não em arquivo do frontend)
 * para publicar sem assinar release do launcher — as Actions estão fora do ar
 * e release é manual.
 */
@Entity('news_posts')
export class NewsPost {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  /** Rótulo curto ("atualização", "evento"...). Vazio = sem rótulo. */
  @Column({ type: 'varchar', length: 32, default: '' })
  tag!: string

  @Column({ type: 'varchar', length: 200 })
  title!: string

  @Column({ type: 'text' })
  body!: string

  /** Separado de createdAt para poder datar um post retroativamente. */
  @Index()
  @Column({ type: 'timestamptz', default: () => 'now()' })
  publishedAt!: Date

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}

/** Formato que o launcher consome. */
export function toPublicPost(post: NewsPost) {
  return {
    id: post.id,
    tag: post.tag,
    title: post.title,
    body: post.body,
    publishedAt: post.publishedAt,
  }
}
