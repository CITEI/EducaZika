import { BoxDocument, BoxInput } from "../model/user/box";
import {
  GAME_MIN_GRADE_PCT,
  GAME_TASK_SAMPLE_QUANTITY,
} from "../pre-start/constants";
import { User, UserDocument, UserInput } from "../model/user/user";
import { categoryService } from "./category";
import { InternalServerError, ObjectNotFoundError, ValidationError } from "./errors";
import { levelService } from "./level";
import { BasicService } from "./utils/basic";
import { Task } from "src/model/game/task";

export enum EvaluationStatus {
  Approved,
  Reproved,
  NoContent,
}

class UserService extends BasicService<UserDocument> {
  constructor() {
    super({ model: User });
  }

  /**
   * Creates a new user and initializes it
   */
  async create(payload: UserInput): Promise<UserDocument> {
    const user = new User(payload);
    user.progress.level = await levelService.findHead();
    user.progress.category = await categoryService.findHead({
      level: user.progress.level,
    });
    user.progress.box = await this.createBox({
      category: user.progress.category,
    });
    await user.save();
    return user;
  }

  /**
   * Finds an User by its id or email
   */
  async find({
    id,
    email,
    select,
  }: {
    id?: string;
    email?: string;
    select?: string;
  }): Promise<UserDocument> {
    let user;
    if (id) user = await super.find({ id, select: select || this.select });
    else
      user = await User.findOne({ email })
        .select(select || this.select)
        .exec();
    if (user) return user;
    throw new ObjectNotFoundError({ schema: User });
  }

  /**
   * Checks if an user exists by its id or email
   */
  async exists({
    id,
    email,
  }: {
    id?: string;
    email?: string;
  }): Promise<boolean> {
    if (id) return super.exists({ id });
    else return (await User.exists({ email }).exec()) == null ? false : true;
  }

  /**
   * Creates a box given a user with defined progress.category
   */
  protected async createBox({
    category,
  }: {
    category: string;
  }): Promise<BoxInput> {
    const box: BoxInput = {
      category: category,
      tasks: (
        await categoryService.sampleTasks({
          id: category,
          quantity: GAME_TASK_SAMPLE_QUANTITY,
        })
      ).map((el: any) => ({ task: el, hits: 0 })),
    };

    return box;
  }

  /**
   * Checks if a user has passed, and decides the next step of the game
   * for it
   */
  async evaluate({
    id,
    answers,
  }: {
    id: string;
    answers: Array<number>;
  }): Promise<EvaluationStatus> {
    const user = await this.find({
      id,
      select: "progress.box progress.category progress.level",
    });

    let grade = 0;
    // update box answers
    if (user.progress.box.tasks.length == answers.length) {
      // get total answers
      await user.populate({
        path: "progress.box.tasks.task",
        select: "questionCount",
        model: "Task",
      });
      let total = 0;
      let hits = 0;
      answers.forEach((el, i) => {
        let count = user.progress.box.tasks[i].task.questionCount;
        if (el <= count && el >= 0) {
          user.progress.box.tasks[i].hits = el;
          total += count;
          hits += el;
        } else
          throw new ValidationError({
            fields: [{ name: "answers", problem: "invalid" }],
          });
      });
      grade = hits / total;
    } else
      throw new ValidationError({
        fields: [{ name: "answers", problem: "missing" }],
      });

    if (grade >= GAME_MIN_GRADE_PCT) {
      let nextLevel = user.progress.level;
      let nextCategory = await categoryService.findNext({
        id: user.progress.category,
      });

      if (!nextCategory) {
        // reached the last category of a level
        nextLevel = await levelService.findNext({ id: nextLevel });
        if (!nextLevel) {
          // if no level, reached the end of the game
          await User.findByIdAndUpdate(id, {
            $set: {
              "progress.level": user.progress.level,
              "progress.category": null,
              "progress.box": null,
            },
            $push: {
              "progress.history": user.progress.box,
            },
          });
          return EvaluationStatus.NoContent;
        } else
          nextCategory = await categoryService.findHead({ level: nextLevel });
      }

      if (nextCategory) {
        await User.findByIdAndUpdate(id, {
          $set: {
            "progress.level": nextLevel,
            "progress.category": nextCategory,
            "progress.box": await this.createBox({
              category: nextCategory._id,
            }),
          },
          $push: {
            "progress.history": user.progress.box,
          },
        });
        return EvaluationStatus.Approved;
      } else
        // level without categories
        throw new InternalServerError()
    } else {
      await User.findByIdAndUpdate(id, {
        $set: {
          "progress.box": await this.createBox({
            category: user.progress.category,
          }),
        },
        $push: { "progress.history": user.progress.box },
      });
      return EvaluationStatus.Reproved;
    }
  }

  /**
   * Returns the current box
   */
  async findBox({ id }: { id: string }): Promise<BoxDocument | null> {
    const user = await this.find({ id, select: "progress.box progress.level" });
    let box = user.progress.box;
    if (box == null) {
      const nextLevel = await levelService.findNext({
        id: user.progress.level,
      });
      if (nextLevel) {
        const nextCategory = await categoryService.findHead({
          level: nextLevel,
        });
        box = await this.createBox({ category: nextCategory!._id });
        await User.findByIdAndUpdate(id, {
          $set: {
            "progress.level": nextLevel,
            "progress.category": nextCategory,
            "progress.box": box,
          },
        });
      }
    }
    if (box) {
      await user.populate({ path: "progress.box.tasks.task", model: Task });
      return user.progress.box;
    }
    return box;
  }

  /**
   * Returns the evaluated boxes history
   */
  async findHistory({
    id,
  }: {
    id: string;
  }): Promise<
    Array<{ category: string; tasks: Array<{ hits: number; name: string }> }>
  > {
    const user = await this.find({ id, select: "progress.history" });
    await user.populate("progress.history.category", "name");
    await user.populate({
      path: "progress.history.tasks.task",
      model: "Task",
      select: "name",
    });
    return user.progress.history.map((box) => ({
      category: box.category.name,
      tasks: box.tasks.map((task) => ({
        hits: task.hits,
        name: task.task.name,
      })),
    }));
  }

  /**
   * Retrieves non-sensitive userdata
   */
  async findUserData({ id }: { id: string }): Promise<UserDocument> {
    return await this.find({
      id,
      select: "email name progress.category progress.level",
    });
  }
}

export const userService = new UserService();
